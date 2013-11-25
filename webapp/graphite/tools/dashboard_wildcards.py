import fnmatch
import json
import re
import marisa_trie
from graphite.dashboard.models import Dashboard

def parseDashboard():
   dashboards = Dashboard.objects.all(id=45)

   for dashboard in dashboards:

      try:
         owners_uid = [owner.user.get_profile().uid for owner in dashboard.owners.all()][0]
         print owners_uid
         all_metrics = getMetrics(owners_uid)

         state  = json.loads(dashboard.state)
         graphs = state['graphs']


         for x in graphs:
            targets = x[1]['target']

            for target in targets:
               metrics = []
               evaluateTargets(metrics, target)

            for metricPattern in metrics:

               if metricPattern.find("*") != -1:
                  matching = graphite_match_entries(all_metrics, metricPattern)
                  length = len(matching)

                  if length > 15:
                     print "User: '%s' with Dashboard '%s', a wildcard matches %s metrics" % (owners_uid, dashboard.name, length)

      except Exception:
         pass #Whatever


def getMetrics(uid, use_cache = True):
   path  = "/var/tmp/wizard/metrics-%s.marisatrie" % uid
   mtrie = marisa_trie.RecordTrie("<ii")
   try:
      mtrie.mmap(path)
   except Exception, ex:
      print("Failed to load metrics from %s: %s" % (path, ex))

   metrics = mtrie.keys()

   return metrics





from graphite.render.grammar import grammar


def evaluateTargets(metrics, target):
  tokens = grammar.parseString(target)
  result = evaluateTokens(metrics, tokens)

  return result


def evaluateTokens(metrics, tokens):
  if tokens.expression:
    return evaluateTokens(metrics, tokens.expression)

  elif tokens.pathExpression:
     metrics.append(tokens.pathExpression)
     return tokens.pathExpression


  elif tokens.call:
    args = [evaluateTokens(metrics, arg) for arg in tokens.call.args]
    return []




# From graphite/finders.py
def _deduplicate(entries):
  yielded = set()
  for entry in entries:
    if entry not in yielded:
      yielded.add(entry)
      yield entry

# From graphite/finders.py
def graphite_match_entries(entries, pattern):
  """A drop-in replacement for fnmatch.filter that supports pattern
  variants (ie. {foo,bar}baz = foobaz or barbaz)."""
  v1, v2 = pattern.find('{'), pattern.find('}')

  if v1 > -1 and v2 > v1:
    variations = pattern[v1+1:v2].split(',')
    variants = [ pattern[:v1] + v + pattern[v2+1:] for v in variations ]
    matching = []

    for variant in variants:
      matching.extend( fnmatch.filter(entries, variant) )

    return list( _deduplicate(matching) ) #remove dupes without changing order

  else:
    matching = fnmatch.filter(entries, pattern)
    matching.sort()
    return matching


if __name__ == "__main__":
   parseDashboard()

