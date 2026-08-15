import { useEffect, useState } from 'react'
import { fetchMembers } from '@/data/members'

/**
 * Member ids to display names, for labelling who holds what.
 *
 * A claim stores a user id, and showing a uuid to someone tells them nothing.
 * Failure is swallowed to an empty map on purpose: the callers all fall back
 * to "another member", which is the useful half of the sentence, and a tender
 * tracker should not go blank because a name lookup failed.
 */
export function useMemberNames(): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let live = true
    void fetchMembers()
      .then((list) => {
        if (live) setNames(new Map(list.map((m) => [m.id, m.fullName || m.email])))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  return names
}
