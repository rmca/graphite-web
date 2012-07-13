import functools
from django.contrib.auth import authenticate, login

def ensure_hg_login(func):

   @functools.wraps(func)
   def ensureLogin(request, *args, **kwargs):
      if request.user and not request.user.id and 'HTTP_REMOTE_USER' in request.META:
         remote_user, uid = request.META['HTTP_REMOTE_USER'].split("/")
         user = authenticate(remote_user=remote_user)
         user.uid = uid
         login(request, user)

      return func(request, *args, **kwargs)

   return ensureLogin
