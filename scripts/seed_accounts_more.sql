insert into admin_users (username, password_hash, must_change) values
  ('az2836787', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('bb1121', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('go8', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('green96125', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('LBS117775', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('ling447', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('love732001', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('mark100625', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('mirage316', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('samevass', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('syun916136', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('vince79055', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('way1130g', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true),
  ('wayne546', '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.', true)
on conflict (username) do nothing;
