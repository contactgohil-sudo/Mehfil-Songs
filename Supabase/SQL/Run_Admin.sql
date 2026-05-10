update public.profiles
set approved = true,
    role = 'admin'
where email = 'YOUR_ADMIN_EMAIL_HERE';
