from django.core.management.base import BaseCommand
from graphite.dashboard.models import Dashboard
import re
from django.template.defaultfilters import slugify


class Command(BaseCommand):
   args = ''
   help = ''


   def handle(self, *args, **options):
      print "\n\n\n ------"
      try:
         dashes = Dashboard.objects.all()
         for dash in dashes:
            dash.slug = slugify(dash.name)
            print "Fixed: '%s'" % dash.slug
            dash.save()

      except Dashboard.DoesNotExist:
         pass


      print "\n\n\n ------"

