#!/usr/bin/python
import sys, os
 
# Add a custom Python path.
#sys.path.insert(0, "/opt/metricfire/site/")
 
# Switch to the directory of your project. (Optional.)
# os.chdir("/opt/metricfire/site/")
 
# Set the DJANGO_SETTINGS_MODULE environment variable.
os.environ['DJANGO_SETTINGS_MODULE'] = "graphite.settings"
 
from django.core.servers.fastcgi import runfastcgi
runfastcgi(method="threaded", daemonize="false")
