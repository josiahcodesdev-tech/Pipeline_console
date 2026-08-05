-- Seeds the consultant roster from the five CVs supplied on 2026-08-05.
--
-- Run in the Supabase SQL Editor, or with:
--   npx supabase db query --linked --file supabase/seed_consultants.sql
--
-- Safe to re-run. Each statement skips an account that already has a
-- consultant of that name, so re-running after adding a sixth CV adds only the
-- sixth and leaves edits made in the app alone.
--
-- The roster is per-account and this project has more than one sign-in with
-- live RFPs against it, so each consultant is inserted for every account:
-- they are the same firm's people either way, and row-level security still
-- keeps the rosters separate. Narrow the `from auth.users u` clause if that
-- ever stops being true.
--
-- Everything below is taken from the CVs as written. Where a CV does not state
-- something — languages on two of them, availability on all five — the field is
-- left empty rather than guessed at, because the drafter treats this roster as
-- fact and will put whatever is here into a live bid.

-- 1. Dr. Benson Kiarie — CEO and lead consultant -----------------------------
insert into public.consultants (
  user_id, name, title, core_expertise, years_experience, sectors, countries,
  qualifications, task_fit, project_experience, languages, availability,
  short_bio, long_bio
)
select u.id,
  $x$Dr. Benson Kiarie$x$,
  $x$Founder & CEO / Lead Trainer — MEAL and Leadership$x$,
  $x$Monitoring, Evaluation, Accountability & Learning (MEAL), Leadership Development & Coaching, Results-Based Management, Participatory Evaluation, M&E System Design, Resource Mobilization & Proposal Development, Strategic Management, Performance Appraisal Frameworks, Training & Facilitation$x$,
  15,
  $x$International NGOs, UN agencies, national and county government, faith-based organisations, corporates, conservation, education$x$,
  $x$Kenya, Uganda, Tanzania, Rwanda, South Sudan, Sudan, Ethiopia, Somalia, Nigeria, Ghana, Malawi, Zambia, Zimbabwe, Namibia, Botswana, Cameroon, Lesotho, Sierra Leone, Liberia, Egypt, Mauritania, Eswatini, Equatorial Guinea, Mauritius, Seychelles, South Africa$x$,
  $x$PhD in Strategic Management, Jomo Kenyatta University of Agriculture and Technology (2023); MBA in Strategic Management, Kenyatta University (2014); Bachelor of Education, Moi University (2009); CPA-K and CPS-K (KASNEB); CHRP (IHRM); Certified Monitoring and Evaluation Professional (KIM); Lean Six Sigma Professional (Institute of Lean Six Sigma Professionals, UK)$x$,
  $x$Team Leader; Lead Facilitator; overall quality assurance; MEAL system design and institutionalisation; leadership development programmes; results-based management training; evaluation design and oversight; strategic planning; performance appraisal frameworks; resource mobilization and proposal development training; client and stakeholder engagement$x$,
  $x$Founder and CEO of Vantage Africa School of Leadership since July 2020, leading a network of over 80 M&E trainers across Africa. Has trained more than 7,000 professionals across 28 countries. Led outcome and impact evaluations for Caritas International and LEWA Wildlife Conservancy. Trained and consulted for Kenya Conference of Catholic Bishops, Anglican Development Services, Daraja Academy, Platinum Credit Plc, Oloolaiser Farmers Cooperative Society, KEMRI-Wellcome Trust, ActionAid, World Vision, Corporate Staffing Services, and the county governments of Laikipia, Bungoma, Kilifi, Bomet and Busia. Developer of Eval360, an AI-powered MEAL platform. Previously Regional Manager, Kenya Institute of Management (Rift Valley and Western Region), overseeing 7 branches and more than 400 staff across 23 counties, and Branch Manager, KIM Nanyuki.$x$,
  '',
  '',
  $x$MEAL specialist and leadership trainer with over 15 years supporting INGOs, UN agencies, governments and community-based organisations across 28 African countries, where he has trained more than 7,000 professionals. Founder and CEO of Vantage Africa and developer of the Eval360 MEAL platform.$x$,
  $x$Dr. Benson Kiarie is a Monitoring, Evaluation, Accountability and Learning specialist and leadership trainer with over 15 years of experience supporting international NGOs, UN agencies, governments and community-based organisations across Africa. His work spans 28 countries, where he has trained more than 7,000 professionals, many operating in fragile and displacement-affected contexts. He brings expertise in results-based management, participatory evaluation, and conflict- and gender-sensitive programming, and has led outcome and impact evaluations for organisations including Caritas International and LEWA Wildlife Conservancy. As Founder and CEO of Vantage Africa School of Leadership he leads a blended team and a network of over 80 M&E trainers across the continent, and serves as lead trainer on flagship programmes in transformational leadership, certified M&E, and resource mobilization. He developed Eval360, an AI-powered MEAL platform enabling organisations to track outcomes in real time. He holds a PhD in Strategic Management, an MBA in Strategic Management and a Bachelor of Education, with certifications as CPA-K, CPS-K, CHRP, Certified M&E Professional and Lean Six Sigma Professional.$x$
from auth.users u
where not exists (
  select 1 from public.consultants c
   where c.user_id = u.id and lower(c.name) = lower($x$Dr. Benson Kiarie$x$)
);

-- 2. Edwin Wekesa Wafula ----------------------------------------------------
insert into public.consultants (
  user_id, name, title, core_expertise, years_experience, sectors, countries,
  qualifications, task_fit, project_experience, languages, availability,
  short_bio, long_bio
)
select u.id,
  $x$Edwin Wekesa Wafula$x$,
  $x$Senior Monitoring, Evaluation & Learning (MEL) / Measurement & Impact Lead$x$,
  $x$MEL and MEAL system design, Theory of Change & Results Frameworks, Mixed-Methods Research, Evidence Synthesis & Insight Communication, Data Systems, Dashboards & Visualisation, Adaptive Learning & Sensemaking, Gender-Responsive & Inclusive MEL, Quality Assurance, Consortium & Stakeholder Management, Team Leadership and Coaching$x$,
  15,
  $x$International development, climate action and adaptation, climate justice, child protection, humanitarian and refugee response, social inclusion, digital transformation, education, health$x$,
  $x$Kenya, Ethiopia, Tanzania, Uganda, Madagascar, Netherlands; multi-country portfolios across 8 African countries and 6 Least Developed Country Front Runner states$x$,
  $x$MA in Project Planning and Management, University of Nairobi (2014); Postgraduate Diploma in Microfinance, Strathmore University (2009); Diploma in Project Management, Kenya Institute of Management (2011); BSc in Mathematics and Physics, University of Nairobi (2005); MEL 360 in Practice — MEL for Systems Change (2025); Results Based Management (2016); Monitoring, Evaluation and Learning, MDF Training & Consultancy (2019)$x$,
  $x$MEL and MEAL system design; theory of change development; results frameworks and indicator design; multi-country and consortium MEL coordination; dashboards, data systems and visualisation; mixed-methods and participatory evaluation; learning facilitation and sensemaking; donor and technical reporting; data quality assurance; capacity strengthening of country teams and partners$x$,
  $x$Global MEL Manager for LIFE-AR at the International Institute for Environment and Development (2024-2026), designing Measurement and Impact systems across six Front Runner countries. Head of Monitoring, Evaluation, Research, Reporting and Learning at the Pan African Climate Justice Alliance, covering 51 national platforms. MEAL Lead for the African Activists for Climate Justice consortium — 5 partner organisations, 10 project components, 8 countries. Regional Planning, Monitoring and Evaluation Lead for Terre des Hommes Netherlands East Africa (5 countries). National M&E Coordinator, SOS Children's Villages International Kenya, across 8 project locations. MEAL Coordinator, CARE International Kenya, on the Refugee Assistance Programme in Dadaab, working to CARE, UNHCR, SPHERE, WHO and HAP standards.$x$,
  $x$English (native or bilingual), Swahili (native or bilingual), French (elementary)$x$,
  '',
  $x$Senior MEL and Measurement & Impact leader with over 15 years designing and running evaluation, learning and evidence functions across international development, climate action and child protection programmes. Experienced in multi-country portfolios, consortium MEAL systems, theory of change development and data visualisation.$x$,
  $x$Edwin Wekesa Wafula is a senior Monitoring, Evaluation and Learning leader with more than 15 years of experience leading end-to-end measurement, evaluation, learning and evidence functions across international development, climate action, social inclusion and digital transformation programmes. He currently serves as Global MEL Manager for the LIFE-AR programme at the International Institute for Environment and Development, where he has led the design and delivery of Measurement and Impact systems across six countries, aligning national MEL frameworks to a global theory of change. He previously headed monitoring, evaluation, research and learning at the Pan African Climate Justice Alliance across 51 national platforms, and established a consortium-wide MEAL system for the African Activists for Climate Justice across five partner organisations, ten project components and eight countries. Earlier roles include Regional PME Lead for Terre des Hommes Netherlands across five African countries, National M&E Coordinator for SOS Children's Villages Kenya, and MEAL Coordinator for CARE International on the Dadaab Refugee Assistance Programme. His strengths include adaptive MEL design, mixed-methods evaluation, dashboards and visualisation, evidence synthesis, and coaching country teams and partners.$x$
from auth.users u
where not exists (
  select 1 from public.consultants c
   where c.user_id = u.id and lower(c.name) = lower($x$Edwin Wekesa Wafula$x$)
);

-- 3. Filmon Hailu Reda ------------------------------------------------------
insert into public.consultants (
  user_id, name, title, core_expertise, years_experience, sectors, countries,
  qualifications, task_fit, project_experience, languages, availability,
  short_bio, long_bio
)
select u.id,
  $x$Filmon Hailu Reda$x$,
  $x$Associate Consultant, Development Evaluation & Management$x$,
  $x$Development Evaluation, M&E Plans and System Design, Theory of Change, Contribution Analysis, Qualitative and Quantitative Evaluation Methods, Economic Policy, Private Sector Development, Labour Market Analysis, Green Economy, Stakeholder Facilitation$x$,
  13,
  $x$Development cooperation, economic policy, private sector development, labour market and employment, TVET and skills, green economy and sustainable land management, humanitarian and emergency response, food security, migration and returnee reintegration, civil society and governance$x$,
  $x$Ethiopia$x$,
  $x$MSc in Development Evaluation and Management, University of Antwerp Institute of Development Policy, Belgium (2011); BA in Economics, Unity University College, Addis Ababa (2004); Certificate, International Seminar for Evaluation Capacity Development, University of Antwerp (2018); Certificate, Research Methodology, SPSS and STATA, Ethiopian Management Institute (2017); Certificate, Evaluation and Applied Research Methods, Claremont Evaluation Center, USA (2016). Member, Ethiopian Evaluation Association; Reference Group Member, African Evidence Network.$x$,
  $x$National evaluation consultant; terminal, mid-term and final independent evaluations; case study design and report writing; qualitative data collection (key informant interviews, focus group discussions, case studies); qualitative data analysis using QDA Miner; quantitative survey planning and management; market and needs assessment; validation workshop facilitation; Ethiopia-based and Horn of Africa assignments$x$,
  $x$Associate Consultant at JIMAT Development Consultants since 2019. National Evaluation Consultant on UNIDO independent terminal evaluations — the Training Institute for Commercial Vehicle Drivers in Ethiopia (2023, funded by Sida), the Ethiopian Coffee Value Chain and the Ethiopian Leather and Leather Products Industry (2021). National Mid-Term Review Consultant, UNIDO Inclusive and Sustainable Industrial Development for Job Creation (2022, BMZ). National Consultant on the Sida Central Evaluation of country strategic objectives (2024-2025). National Consultant, ILO/EU independent final evaluation of Support to the Reintegration of Returnees in Ethiopia (2019). Consultant on the USAID Joint Emergency Operation market baseline and cash feasibility assessment for Catholic Relief Services (2021-2022). Qualitative evaluation specialist on the Ethiopia Response Initiative baseline for the Open Society Foundation (2021). Monitoring and Evaluation Specialist, Urban Productive Safety Net Project (2016-2017). Economic Affairs Expert, Office of the Prime Minister of Ethiopia (2005-2009). Published on development evaluation culture in Ethiopia in the African Development Bank Evaluation Matters journal (2020).$x$,
  $x$Amharic (C2), English (C2), Tigrigna (B2)$x$,
  '',
  $x$Development evaluation specialist based in Addis Ababa with 13 years in consulting and applied research across economic policy, private sector development and labour markets, and continuous professional experience in Ethiopia since 2004. Regular national evaluation consultant to UNIDO, ILO, Sida and CRS.$x$,
  $x$Filmon Hailu Reda is a development evaluation specialist based in Addis Ababa, with 13 years of professional experience in consulting and applied research across economic policy, private sector development and labour market analysis, and continuous professional experience in Ethiopia since 2004. He holds an MSc in Development Evaluation and Management from the University of Antwerp and a BA in Economics. As an Associate Consultant with JIMAT Development Consultants he leads the firm development evaluation and aid effectiveness portfolio, providing technical expertise as team leader, thematic expert and quality assurance expert. He has served as national evaluation consultant on independent terminal evaluations and mid-term reviews for UNIDO across TVET, coffee value chain, leather industry and inclusive industrial development projects, and on evaluations for the ILO, Sida, Catholic Relief Services and the Open Society Foundation. He prepares M&E plans and designs M&E systems, conducts final independent evaluations using theory of change and contribution analysis approaches, and works across qualitative and quantitative methods including QDA Miner analysis and electronic data collection with ODK. He is a member of the Ethiopian Evaluation Association and a reference group member of the African Evidence Network.$x$
from auth.users u
where not exists (
  select 1 from public.consultants c
   where c.user_id = u.id and lower(c.name) = lower($x$Filmon Hailu Reda$x$)
);

-- 4. Nicholas Oloo ----------------------------------------------------------
insert into public.consultants (
  user_id, name, title, core_expertise, years_experience, sectors, countries,
  qualifications, task_fit, project_experience, languages, availability,
  short_bio, long_bio
)
select u.id,
  $x$Nicholas Oloo$x$,
  $x$Monitoring and Evaluation Specialist / Trainer$x$,
  $x$Monitoring & Evaluation, Baseline Surveys, Midterm and Final Evaluations, Impact Assessment, Results-Based Management, Logical Framework and Theory of Change, Project Management, Training, Coaching and Mentoring, Proposal and Report Writing, Electronic Mobile Data Collection, Data Analysis$x$,
  8,
  $x$Humanitarian and emergency response, food security and livelihoods, community managed disaster risk reduction, WASH, natural resources management, education, HIV/AIDS, advocacy, refugee programming$x$,
  $x$Kenya, Somalia, Uganda, Tanzania, South Sudan$x$,
  $x$PhD in Strategic Management, Jomo Kenyatta University of Agriculture and Technology (from 2016); MA in Project Planning and Management, University of Nairobi (2014); BSc in Natural Resources Management, Second Class Honours Upper Division, Moi University (2009); Monitoring and Evaluation Fundamentals, USAID (2011); Community Managed Disaster Risk Reduction, IIRR (2012); Participatory Methods and Approaches in Assessments, Catholic Relief Services (2012); Food Security and Livelihoods Concepts and Frameworks, FAO (2011)$x$,
  $x$Baseline, midterm and final evaluations; M&E system and framework design; performance monitoring and evaluation plans; results-based management training; logframe and theory of change facilitation; enumerator training and field team supervision; electronic mobile data collection using SurveyCTO and ODK; data analysis in Excel, SPSS and STATA; humanitarian, resilience and livelihoods programmes$x$,
  $x$Monitoring and Evaluation Specialist, UNICEF Kenya Country Office, including technical leadership on Multiple Indicator Cluster Surveys across six counties. Regional Monitoring and Evaluation Programme Officer for the Horn and East Africa at CAFOD. Monitoring and Evaluation Programme Officer at SADO Somalia. Monitoring and Evaluation Officer at the Rockefeller Foundation. Research, Monitoring and Evaluation Assistant at the Kenya Red Cross Society. Independent consultancies include the midterm review of the Arid Lands Support Programme in Mandera for Save the Children; midterm evaluation of the Strengthening Community Resilience Programme in Wajir for Oxfam Kenya; midterm evaluation of the Urban Refugee Livelihoods Support Project in Nairobi for UNHCR; final evaluation and third party monitoring of the Early Livelihood Recovery Project in Somalia for Oxfam Novib; and evaluation of the Farmland Rehabilitation and Floods Prevention Project in Lower Shabelle for the ICRC.$x$,
  $x$English (fluent), Swahili (fluent), French (basic)$x$,
  '',
  $x$M&E specialist and trainer with experience across Kenya, Somalia, Uganda, Tanzania and South Sudan, covering baselines, midterm and final evaluations for livelihoods, food security, WASH, DRR and education programmes. Experienced trainer in results-based management, logframes and theory of change.$x$,
  $x$Nicholas Oloo is a Monitoring and Evaluation specialist and trainer with professional and managerial experience in project management and evaluation, including baselines, midterm and final evaluations for livelihoods, food security, community managed disaster risk reduction, WASH, natural resources management, education, HIV/AIDS and advocacy interventions. He has worked in Kenya, Somalia, Uganda, Tanzania and South Sudan, across humanitarian, recovery and development contexts using the Linking Relief, Recovery and Development approach. He has held M&E roles with UNICEF Kenya, CAFOD Horn and East Africa, SADO Somalia, the Rockefeller Foundation and the Kenya Red Cross Society, and has undertaken independent evaluation assignments for Save the Children, Oxfam Kenya, UNHCR, Oxfam Novib Somalia and the ICRC. He trains, coaches and mentors in results-based management, project management, monitoring and evaluation, baseline surveys, impact assessment, logical frameworks, theory of change, and proposal and report writing. He works with electronic data collection platforms including SurveyCTO and ODK Collect and analyses data using Excel, SPSS and STATA.$x$
from auth.users u
where not exists (
  select 1 from public.consultants c
   where c.user_id = u.id and lower(c.name) = lower($x$Nicholas Oloo$x$)
);

-- 5. Dr. Morrisson Kaunda Mutuku --------------------------------------------
insert into public.consultants (
  user_id, name, title, core_expertise, years_experience, sectors, countries,
  qualifications, task_fit, project_experience, languages, availability,
  short_bio, long_bio
)
select u.id,
  $x$Dr. Morrisson Kaunda Mutuku$x$,
  $x$Lecturer and Research Fellow, Kenyatta University — M&E and Information Systems Consultant$x$,
  $x$Project Monitoring and Evaluation, Management Information Systems, Online Survey Tool Development, Quantitative and Qualitative Research, Feasibility and Baseline Surveys, Curriculum Development, Workshop Facilitation, Report Writing, Project and Programme Coordination, Data Analysis, Knowledge Management$x$,
  10,
  $x$Higher education, public sector and county government, telecommunications and internet, banking and financial services, postal services, agriculture value chains, civil society$x$,
  $x$Kenya, Uganda, Somalia$x$,
  $x$PhD in Management Information Systems, Kenyatta University (2019); MBA in Management Information Systems, Kenyatta University (2013); BSc in Information Technology, Jomo Kenyatta University of Agriculture and Technology (2008); Statistical Data Analysis using R, Kenyatta University (2016); AEA Training-of-Trainers on Design Thinking (2020); Open Source Software, Freecode International (2010). Member of the Association for Computing Machinery and the Internet Society, Kenya Chapter.$x$,
  $x$Survey and feasibility study design; online survey tool development; baseline and endline surveys; customer satisfaction, brand and market studies; quantitative data analysis; capacity assessment; management information systems assessment and design; research methods and project management training at postgraduate level; curriculum development; workshop facilitation; report writing$x$,
  $x$Lecturer in the Department of Management Science, School of Business, Kenyatta University since 2014, teaching management information systems, project planning and design, project management consultancy and risk management. External Evaluation of the Somali Experts Secondment Programme for the Nordic International Support Foundation (2021). Kenya Internet Market Analysis Survey for Advanced Middle East Systems (2021). Civil Society Organization Capacity Assessment in Wajir County (2020). Operations, Brand and Customer Satisfaction Survey for the Postal Corporation of Kenya. Baseline survey on creating shared value in the maize value chain. Mobile, internet and networks feasibility surveys in Kenya and Uganda. Nine papers published in refereed journals; supervisor to more than fifteen Masters students and several PhD candidates in project and stakeholder management.$x$,
  '',
  '',
  $x$University lecturer, research fellow and trainer with over ten years across information systems and project management in teaching, research and consultancy. Strengths in survey design, online data collection tools, quantitative analysis and monitoring and evaluation, with published research and postgraduate supervision.$x$,
  $x$Dr. Morrisson Kaunda Mutuku is a lecturer and research fellow at Kenyatta University with over ten years of experience across information systems and project management in teaching, research and consultancy capacities. Skills include online survey tool development, monitoring and evaluation, quantitative and qualitative research, curriculum development, workshop facilitation, report writing and project coordination. Consultancy assignments include the external evaluation of the Somali Experts Secondment Programme for the Nordic International Support Foundation, a Civil Society Organization capacity assessment in Wajir County, the Kenya Internet Market Analysis Survey, an operations, brand and customer satisfaction survey for the Postal Corporation of Kenya, and a baseline survey on shared value in the maize value chain. Research interests cover business information systems, internet and cyber security, project monitoring and evaluation, and knowledge management. Holds a PhD in Management Information Systems and an MBA in the same field from Kenyatta University, and a BSc in Information Technology from JKUAT, with nine papers published in refereed journals and supervision of more than fifteen Masters students.$x$
from auth.users u
where not exists (
  select 1 from public.consultants c
   where c.user_id = u.id and lower(c.name) = lower($x$Dr. Morrisson Kaunda Mutuku$x$)
);
