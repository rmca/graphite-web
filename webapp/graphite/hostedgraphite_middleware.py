from django.contrib.auth import authenticate, login

class HostedGraphiteMiddleware(object):

   def __init__(self):
      pass


   def process_request(self, request):

      if request.user and not request.user.id and 'HTTP_REMOTE_USER' in request.META:
         remote_user, uid = request.META['HTTP_REMOTE_USER'].split("/")
         user = authenticate(remote_user=remote_user)
         user.uid = uid
         login(request, user)

      return None


