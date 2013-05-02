"""Copyright 2008 Orbitz WorldWide

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License."""

from django.conf.urls import *
from django.conf import settings
from django.contrib import admin
from django.http import HttpResponseForbidden
from django.views.generic.simple import redirect_to

admin.autodiscover()


UUID_PATTERN = '[\w\d]{8}-[\w\d]{4}-[\w\d]{4}-[\w\d]{4}-[\w\d]{12}'


def forbidden(request):
   return HttpResponseForbidden()

from django.http import HttpResponse

urlpatterns = patterns('',

  ('^[a-z0-9]{8}/%s/graphite/content/(?P<path>.*)$' % UUID_PATTERN, 'django.views.static.serve', {'document_root' : settings.CONTENT_DIR}),
  ('^[a-z0-9]{8}/graphite/content/(?P<path>.*)$', 'django.views.static.serve', {'document_root' : settings.CONTENT_DIR}),
  ('^admin/', include(admin.site.urls)),
  ('^[a-z0-9]{8}/%s/graphite/render/?' % UUID_PATTERN, include('graphite.render.urls')),
  ('^[a-z0-9]{8}/%s/graphite../render/?' % UUID_PATTERN, include('graphite.render.urls')),
  ('^[a-z0-9]{8}/graphite/render/',                    include('graphite.render.urls')),
  ('^[a-z0-9]{8}/graphite../render/',                    include('graphite.render.urls')),
  ('^cli/?', include('graphite.cli.urls')),
  ('^[a-z0-9]{8}/graphite/composer/',  include('graphite.composer.urls')),
  ('^[a-z0-9]{8}/%s/graphite/metrics/' % UUID_PATTERN,   include('graphite.metrics.urls')),
  ('^[a-z0-9]{8}/graphite/metrics/',   include('graphite.metrics.urls')),
  ('^[a-z0-9]{8}/graphite/browser/',   include('graphite.browser.urls')),

  ('^[a-z0-9]{8}/%s/graphite/browser/?' % UUID_PATTERN, include('graphite.browser.urls')),
  ('^[a-z0-9]{8}/graphite/browser/',   include('graphite.browser.urls')),
  ('^[a-z0-9]{8}/graphite/account/',   include('graphite.account.urls')),

  ('^[a-z0-9]{8}/%s/graphite/dashboard/load/(?P<slug>[^/]+)?' % UUID_PATTERN, 'graphite.dashboard.views.load'),
  ('^[a-z0-9]{8}/%s/graphite/dashboard/find/$' % UUID_PATTERN, 'graphite.dashboard.views.find'),
  ('^[a-z0-9]{8}/%s/graphite/dashboard/$'       % UUID_PATTERN, 'graphite.dashboard.views.dashboard'),

  ('^[a-z0-9]{8}/graphite/dashboard/', include('graphite.dashboard.urls')),

  ('^whitelist/', include('graphite.whitelist.urls')),
  ('^graphitecontent/(?P<path>.*)$', 'django.views.static.serve', {'document_root' : settings.CONTENT_DIR}),
  ('^[a-z0-9]{8}/%s/graphite/graphlot/' % UUID_PATTERN, include('graphite.graphlot.urls')),
  ('^[a-z0-9]{8}/graphite/graphlot/',                   include('graphite.graphlot.urls')),
  #('^[a-z0-9]{8}/graphite/version/',                    include('graphite.version.urls')),
  #('^[a-z0-9]{8}/graphite/events/',                     include('graphite.events.urls')),

  # Ban uuid access to non-read-only parts of graphite
  ('^[a-z0-9]{8}/%s/graphite/?.*?/?' % UUID_PATTERN, forbidden),

  ('', 'graphite.browser.views.browser')
)

handler500 = 'graphite.views.server_error'
