from django.contrib.auth import authenticate, login
from django.core.exceptions import ImproperlyConfigured

class HostedGraphiteMiddleware(object):

   def __init__(self):
      pass


   def process_request(self, request):

      if request.user and not request.user.id:
         if'HTTP_REMOTE_USER' in request.META:
            remote_user, uid = request.META['HTTP_REMOTE_USER'].split("/")
            user = authenticate(remote_user=remote_user)
            user.uid = uid
            request.user = user

      if 'HTTP_READ_ONLY_USER' in request.META:
         request.session['READ_ONLY_USER'] = True

      return None


