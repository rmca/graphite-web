import os
import fnmatch
from os.path import islink, isdir, isfile, realpath, join, dirname, basename
from glob import glob
from graphite.node import BranchNode, LeafNode
from graphite.readers import WhisperReader, GzippedWhisperReader, RRDReader, MetricfireReader
from graphite.util import find_escaped_pattern_fields

from graphite.logger import log
import redis
import httplib2
import json
import logging
import marisa_trie
import re
import time
import requests

sesh = requests.Session()

#setDefaultSliceCachingBehavior('all')

class CeresFinder:
  def __init__(self, directory):
    self.directory = directory
    self.tree = CeresTree(directory)

  def find_nodes(self, query):
    for fs_path in glob( self.tree.getFilesystemPath(query.pattern) ):
      metric_path = self.tree.getNodePath(fs_path)

      if CeresNode.isNodeDir(fs_path):
        ceres_node = self.tree.getNode(metric_path)

        if ceres_node.hasDataForInterval(query.startTime, query.endTime):
          real_metric_path = get_real_metric_path(fs_path, metric_path)
          reader = CeresReader(ceres_node, real_metric_path)
          yield LeafNode(metric_path, reader)

      elif isdir(fs_path):
        yield BranchNode(metric_path)

sesh = requests.Session()

class MetricfireFinder:
   def __init__(self, mfurl):#, redishostport):
      self._mfurl = mfurl
      #self._redishostport = redishostport
      #self._redis = redis.Redis(redishostport)

   def find_nodes(self, uid, query):
      pattern = query.pattern
      if ':' in pattern:
         pattern, view = pattern.split(":", 1)
         suffix = ':' + view
      else:
         view = None
         suffix = ""
   
      # Get the switches dict for this user.
      switches = json.loads(open("/var/tmp/wizard/uid-switches.json").read())[uid]
      
      # Limit the matching to metrics that have been seen more recently than
      # three hours before the start of the query period.
      stale_metric_match_period = switches.get("stale_metric_match_period", None)
      if stale_metric_match_period is not None and query.startTime is not None:
         try:
            since = query.startTime - (60 * 60 * int(stale_metric_match_period))
         except ValueError:
            logging.error("User %s has an invalid stale_metric_match_period: %s" % (uid, repr(stale_metric_match_period)))
            since = None
      else:
         since = None
      
      path = "/var/tmp/wizard/metrics-%s.marisatrie" % uid 
      mtrie = marisa_trie.RecordTrie("<ii")
      try:
         mtrie.mmap(path)
      except Exception, ex:
         logging.error("Failed to load metrics from %s: %s" % (path, ex))

      # Match metrics up to the first wildcard as an optimisation to take
      # advantage of the prefix matching offered by marisa tries.
      prefix = re.split("[*{]", pattern)[0]
      
      # The marisa trie stuff is picky about only getting unicode inputs for keys and key prefixes.
      if len(prefix) == 0:
         metrics = mtrie.iterkeys()
      else:
         metrics = mtrie.iterkeys(unicode(prefix))

      # Initial listing, first level only.
      if pattern == "*":
         first_level_branch_nodes = set()
         for metric in metrics:
            levels = metric.split(".")
            if len(levels) == 1:
               yield LeafNode(metric + suffix, MetricfireReader(self._mfurl, uid, metric, view, session=sesh))
            else:
               # Don't produce the same branch node a bajillion times because other parts of Graphite
               # seem to be slow at deuping it.
               if levels[0] not in first_level_branch_nodes:
                  yield BranchNode(levels[0])
                  first_level_branch_nodes.add(levels[0])

      # Want a set of branch and leaf nodes at this level.
      #elif pattern.endswith(".*"):
      #   print "waf"
      #   patternroot = pattern[:-1]
      #   for metric in match_entries(metrics, pattern):
      #      partialmetric = metric[len(patternroot):]
      #      levels = partialmetric.split(".")
      #      if len(levels) == 1:
      #         yield LeafNode(metric + suffix, MetricfireReader(self._mfurl, uid, metric, view))
      #      else:
      #         yield BranchNode(patternroot + levels[0])
      
      # Want a set of leaf nodes at this level, and branch nodes at this level.
      elif pattern.endswith("*"):
         levels_in_pattern = pattern.count(".") + 1
         for metric in match_entries(metrics, pattern):
            # Trim the matching metric to the same number of levels as in the pattern.
            levels = metric.split(".")
            #print metric
            #print "found %d levels in metric" % len(levels)
            #print "trimming to %d levels" % levels_in_pattern
            if len(levels) == levels_in_pattern:
               # Leaf node
               #print "leaf:  ", metric
               yield LeafNode(metric + suffix, MetricfireReader(self._mfurl, uid, metric, view, session=sesh))
            else:
               # Branch node
               branch = ".".join(levels[:levels_in_pattern])
               #print "branch:", branch
               yield BranchNode(branch)

            ## Find the index of the next dot in the path (if any)
            #try:
            #   index = metric.index(".", pattern_length)
            #except ValueError:
            #   # No more levels, this is a leaf node.
            #   yield LeafNode(metric + suffix, MetricfireReader(self._mfurl, uid, metric, view))
            #   continue

            ## Strip any metric content after this level.
            #metric = metric[:index]

            #yield BranchNode(metric)

      # Not doing a search, want a specific set of leaf nodes.
      else:
         for metric in match_entries(metrics, pattern):
            # Skip this metric if since-limiting is turned on and if the metric hasn't been updated in a while.
            if since is not None:
               first, last = mtrie[metric][0]
               if last < since:
                  if switches.get("stale_metric_match_logging", False):
                     age = int((time.time() - last) / 3600)
                     logging.warning("Filtered stale metric %s because it was last updated %d hours ago. (%d)" % (metric, age, last))
                     
                  continue

            yield LeafNode(metric + suffix, MetricfireReader(self._mfurl, uid, metric, view, session=sesh))

class StandardFinder:
  DATASOURCE_DELIMETER = '::RRD_DATASOURCE::'

  def __init__(self, directories):
    self.directories = directories

  def find_nodes(self, query):
    clean_pattern = query.pattern.replace('\\', '')
    pattern_parts = clean_pattern.split('.')

    for root_dir in self.directories:
      for absolute_path in self._find_paths(root_dir, pattern_parts):
        if basename(absolute_path).startswith('.'):
          continue

        if self.DATASOURCE_DELIMETER in basename(absolute_path):
          (absolute_path, datasource_pattern) = absolute_path.rsplit(self.DATASOURCE_DELIMETER, 1)
        else:
          datasource_pattern = None

        relative_path = absolute_path[ len(root_dir): ].lstrip('/')
        metric_path = fs_to_metric(relative_path)
        real_metric_path = get_real_metric_path(absolute_path, metric_path)

        metric_path_parts = metric_path.split('.')
        for field_index in find_escaped_pattern_fields(query.pattern):
          metric_path_parts[field_index] = pattern_parts[field_index].replace('\\', '')
        metric_path = '.'.join(metric_path_parts)

        # Now we construct and yield an appropriate Node object
        if isdir(absolute_path):
          yield BranchNode(metric_path)

        elif isfile(absolute_path):
          if absolute_path.endswith('.wsp') and WhisperReader.supported:
            reader = WhisperReader(absolute_path, real_metric_path)
            yield LeafNode(metric_path, reader)

          elif absolute_path.endswith('.wsp.gz') and GzippedWhisperReader.supported:
            reader = GzippedWhisperReader(absolute_path, real_metric_path)
            yield LeafNode(metric_path, reader)

          elif absolute_path.endswith('.rrd') and RRDReader.supported:
            if datasource_pattern is None:
              yield BranchNode(metric_path)

            else:
              for datasource_name in RRDReader.get_datasources(absolute_path):
                if match_entries([datasource_name], datasource_pattern):
                  reader = RRDReader(absolute_path, datasource_name)
                  yield LeafNode(metric_path + "." + datasource_name, reader)

  def _find_paths(self, current_dir, patterns):
    """Recursively generates absolute paths whose components underneath current_dir
    match the corresponding pattern in patterns"""
    pattern = patterns[0]
    patterns = patterns[1:]
    try:
      entries = os.listdir(current_dir)
    except OSError as e:
      log.exception(e) 
      entries = []

    subdirs = [e for e in entries if isdir( join(current_dir,e) )]
    matching_subdirs = match_entries(subdirs, pattern)

    if len(patterns) == 1 and RRDReader.supported: #the last pattern may apply to RRD data sources
      files = [e for e in entries if isfile( join(current_dir,e) )]
      rrd_files = match_entries(files, pattern + ".rrd")

      if rrd_files: #let's assume it does
        datasource_pattern = patterns[0]

        for rrd_file in rrd_files:
          absolute_path = join(current_dir, rrd_file)
          yield absolute_path + self.DATASOURCE_DELIMETER + datasource_pattern

    if patterns: #we've still got more directories to traverse
      for subdir in matching_subdirs:

        absolute_path = join(current_dir, subdir)
        for match in self._find_paths(absolute_path, patterns):
          yield match

    else: #we've got the last pattern
      files = [e for e in entries if isfile( join(current_dir,e) )]
      matching_files = match_entries(files, pattern + '.*')

      for basename in matching_files + matching_subdirs:
        yield join(current_dir, basename)


def fs_to_metric(path):
  dirpath = dirname(path)
  filename = basename(path)
  return join(dirpath, filename.split('.')[0]).replace('/','.')


def get_real_metric_path(absolute_path, metric_path):
  # Support symbolic links (real_metric_path ensures proper cache queries)
  if islink(absolute_path):
    real_fs_path = realpath(absolute_path)
    relative_fs_path = metric_path.replace('.', '/')
    base_fs_path = absolute_path[ :-len(relative_fs_path) ]
    relative_real_fs_path = real_fs_path[ len(base_fs_path): ]
    return fs_to_metric( relative_real_fs_path )

  return metric_path

def _deduplicate(entries):
  yielded = set()
  for entry in entries:
    if entry not in yielded:
      yielded.add(entry)
      yield entry

def match_entries(entries, pattern):
  """A drop-in replacement for fnmatch.filter that supports pattern
  variants (ie. {foo,bar}baz = foobaz or barbaz)."""
  v1, v2 = pattern.find('{'), pattern.find('}')

  if v1 > -1 and v2 > v1:
    variations = pattern[v1+1:v2].split(',')
    variants = [ pattern[:v1] + v + pattern[v2+1:] for v in variations ]
    matching = []

    # This makes len(variants) passes over entries, so we need to make sure
    # entries is a list and not a generator, otherwise only the first variant
    # will be matched.
    entries = list(entries)

    for variant in variants:
      matching.extend( fnmatch.filter(entries, variant) )

    return list( _deduplicate(matching) ) #remove dupes without changing order

  else:
    matching = fnmatch.filter(entries, pattern)
    matching.sort()
    return matching
