import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { fetchNotice } from '../concept-note/notice.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
})
const env = (name: string) => Deno.env.get(name)?.trim() ?? ''
const MAX_REQUEST_BYTES = 22 * 1024 * 1024
const MAX_PDF_BASE64_CHARS = 21 * 1024 * 1024
const MAX_KNOWLEDGE_CHARS = 200_000
const MAX_KNOWLEDGE_CHUNKS = 50

const ANALYSIS_SCHEMA = {
  name: 'tender_analysis', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['summary','metadata','evaluation','deliverables','requirements','gaps'],
    properties: {
      summary: { type: 'string' },
      metadata: {
        type: 'object', additionalProperties: false,
        required: ['client','contractingAuthority','implementingPartners','donor','projectOwner','title','reference','deadline','budgetCeiling','currency','location','duration','submissionMethod'],
        properties: Object.fromEntries(['client','contractingAuthority','implementingPartners','donor','projectOwner','title','reference','deadline','budgetCeiling','currency','location','duration','submissionMethod'].map((key) => [key, { type: ['string','null'] }]))
      },
      evaluation: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['criterion','weight','evidence','source'], properties: { criterion:{type:'string'}, weight:{type:['number','null']}, evidence:{type:'string'}, source:{type:'string'} } } },
      deliverables: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name','format','due','source'], properties: { name:{type:'string'}, format:{type:['string','null']}, due:{type:['string','null']}, source:{type:'string'} } } },
      requirements: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id','verbatim','strength','category','timing','source','evidenceAvailable','gapAction'], properties: { id:{type:'string'}, verbatim:{type:'string'}, strength:{enum:['Mandatory','Scored','Recommended','Informational']}, category:{enum:['Eligibility','Technical','Deliverable','Personnel','Commercial','Submission','Legal','Safeguarding','Data protection','Other']}, timing:{type:['string','null']}, source:{type:'string'}, evidenceAvailable:{type:'boolean'}, gapAction:{type:['string','null']} } } },
      gaps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['requirementIds','severity','description','action'], properties: { requirementIds:{type:'array',items:{type:'string'}}, severity:{enum:['blocking','score-risk','information']}, description:{type:'string'}, action:{type:'string'} } } }
    }
  }
} as const

function responseText(result: Record<string, unknown>): string {
  if (typeof result.output_text === 'string' && result.output_text) return result.output_text
  const output = Array.isArray(result.output) ? result.output : []
  return output.flatMap((item) => item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as Array<Record<string, unknown>> : [])
    .map((item) => typeof item.text === 'string' ? item.text : '').filter(Boolean).join('\n')
}

async function openaiLayout(base64: string, fileName: string) {
  if (!fileName.toLowerCase().endsWith('.pdf')) {
    throw new Error('Tender ingestion currently supports PDF files.')
  }
  const result = await openai('responses', {
    model:'gpt-4.1-mini',
    input:[{role:'user',content:[
      {type:'input_file',filename:fileName || 'tender.pdf',file_data:`data:application/pdf;base64,${base64}`},
      {type:'input_text',text:'Transcribe this tender faithfully as Markdown. Preserve section hierarchy, numbered clauses, tables, and page provenance using <!-- PAGE n --> markers. Remove repeated headers and footers. Do not summarize, interpret, or invent text.'}
    ]}]
  })
  const markdown = responseText(result)
  if (!markdown) throw new Error('OpenAI document ingestion returned no text.')
  return {provider:'openai-pdf-layout',model:'gpt-4.1-mini',pages:0,markdown,tables:[],paragraphs:[]}
}

async function openai(path: string, body: unknown) {
  const key = env('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY is not configured.')
  const response = await fetch(`https://api.openai.com/v1/${path}`, { method:'POST', headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'}, body:JSON.stringify(body) })
  if (!response.ok) {
    console.error('OpenAI request failed', response.status, (await response.text()).slice(0, 1000))
    throw new Error(`The document intelligence provider failed (${response.status}).`)
  }
  return response.json()
}

async function embedding(input: string): Promise<number[]> {
  const result = await openai('embeddings', { model:'text-embedding-3-small', input:input.slice(0, 24000), encoding_format:'float' })
  return result.data[0].embedding
}

function chunks(text: string, max = 5000): string[] {
  const sections = text.split(/\n(?=#{1,4}\s|<!-- PAGE \d+ -->)/).filter((part) => part.trim())
  const output: string[] = []
  for (const section of sections) {
    for (let offset = 0; offset < section.length; offset += max - 500) output.push(section.slice(offset, offset + max))
  }
  return output
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers:CORS })
  if (request.method !== 'POST') return json({error:'Method not allowed'}, 405)
  try {
    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return json({error:'Request body is too large.'},413)
    const auth = request.headers.get('Authorization') ?? ''
    const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global:{headers:{Authorization:auth}} })
    const { data:{user} } = await supabase.auth.getUser()
    if (!user) return json({error:'Unauthorized'}, 401)
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return json({error:'Request body is too large.'},413)
    const body = JSON.parse(raw)
    const action = String(body.action ?? '')
    const quota = action === 'retrieve' ? 120 : action === 'index' ? 50 : 30
    const {data:quotaAllowed,error:quotaError} = await supabase.rpc('consume_api_quota',{quota_action:`tender-${action || 'unknown'}`,max_calls:quota,window_seconds:3600})
    if (quotaError) return json({error:'Could not verify the document-processing allowance.'},503)
    if (!quotaAllowed) return json({error:'The hourly document-processing limit has been reached. Try again later.'},429)

    if (action === 'ingest') {
      if (typeof body.base64 !== 'string' || !body.base64) return json({error:'Document data is required.'}, 400)
      if (body.base64.length > MAX_PDF_BASE64_CHARS) return json({error:'The PDF is too large. Use a file under 15 MB.'},413)
      if (!body.base64.startsWith('JVBERi0')) return json({error:'The uploaded content is not a valid PDF.'},400)
      return json(await openaiLayout(body.base64, String(body.fileName ?? 'tender.pdf')))
    }

    if (action === 'analyze') {
      const fetched = body.url ? await fetchNotice(String(body.url)) : { text:'', problem:null }
      const source = [String(body.text ?? ''), fetched.text].filter(Boolean).join('\n\n## Published source\n').slice(0, 120000)
      const knowledge = String(body.knowledge ?? '').slice(0, 30000)
      if (!source) return json({error:'Tender text is required.'}, 400)
      const completion = await openai('chat/completions', {
        model:'gpt-4.1-mini', temperature:0,
        response_format:{type:'json_schema',json_schema:ANALYSIS_SCHEMA},
        messages:[
          {role:'system',content:'Extract tender facts only. Never infer missing values. Resolve and distinguish the contracting authority, implementing partner(s), donor/funder, project owner and beneficiaries; do not substitute an aggregator or tracker label for the buyer named in the authoritative tender. Source locations must cite supplied page markers or section headings. Capture every shall, must, should, required, mandatory, submit, include and provide clause. EvidenceAvailable is true only when the supplied company knowledge directly supports it.'},
          {role:'user',content:`COMPANY KNOWLEDGE\n${knowledge || 'None supplied'}\n\nTENDER\n${source}`}
        ]
      })
      const content = completion.choices?.[0]?.message?.content
      return json({ analysis:JSON.parse(content), noticeText:fetched.text, noticeProblem:fetched.problem })
    }

    if (action === 'enrich') {
      const queries = [String(body.reference ?? ''), `"${String(body.exactPhrase ?? '').slice(0,180)}"`, `${String(body.client ?? '')} procurement awards strategy news`].filter((q) => q.replace(/["\s]/g,'').length > 3)
      const researched = await openai('responses', {
        model:'gpt-4.1-mini', tools:[{type:'web_search'}],
        input:`Research these tender and client queries. Prefer the issuing organization's procurement portal and official publications. Distinguish verified facts from inference.\n${queries.map((query) => `- ${query}`).join('\n')}`
      })
      const text = responseText(researched)
      const output = Array.isArray(researched.output) ? researched.output : []
      const urls = new Map<string,string>()
      for (const item of output) {
        const contents = item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as Array<Record<string, unknown>> : []
        for (const content of contents) {
          const annotations = Array.isArray(content.annotations) ? content.annotations as Array<Record<string, unknown>> : []
          for (const annotation of annotations) {
            if (annotation.type === 'url_citation' && typeof annotation.url === 'string') urls.set(annotation.url, typeof annotation.title === 'string' ? annotation.title : annotation.url)
          }
        }
      }
      return json({provider:'openai-web-search',queries,summary:text,results:Array.from(urls, ([url,title]) => ({query:'combined research',title,url,content:'See cited source and research summary.',score:1}))})
    }

    if (action === 'index') {
      const sourceType = String(body.sourceType ?? '')
      const title = String(body.title ?? '').trim()
      const sourceId = String(body.sourceId ?? '')
      const content = String(body.content ?? '').trim().slice(0, MAX_KNOWLEDGE_CHARS)
      if (!title || !content) return json({error:'Title and content are required.'},400)
      await supabase.from('knowledge_chunks').delete().eq('source_type',sourceType).eq('source_id',sourceId)
      const rows = []
      for (const [index, part] of chunks(content).slice(0, MAX_KNOWLEDGE_CHUNKS).entries()) rows.push({user_id:user.id,source_type:sourceType,source_id:sourceId,title,content:part,metadata:{chunk:index},embedding:await embedding(part)})
      const {error} = await supabase.from('knowledge_chunks').insert(rows)
      if (error) throw error
      return json({indexed:rows.length})
    }

    if (action === 'retrieve') {
      const query = String(body.query ?? '').trim()
      if (!query) return json({error:'Query is required.'},400)
      const vector = await embedding(query)
      const {data,error} = await supabase.rpc('match_knowledge_chunks',{query_embedding:vector,match_count:body.limit ?? 12,minimum_similarity:body.minimumSimilarity ?? 0.35})
      if (error) throw error
      return json({matches:data ?? []})
    }
    return json({error:'Unknown action'},400)
  } catch (cause) {
    const incident = crypto.randomUUID()
    console.error(`[tender-intelligence:${incident}]`, cause)
    return json({error:`Tender intelligence failed. Reference: ${incident}`},500)
  }
})
