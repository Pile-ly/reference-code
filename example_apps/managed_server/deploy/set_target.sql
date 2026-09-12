-- set_target.sql — flip the pilely_registered_pile row for this app onto
-- a launched box, then back to the resting state. Three statements: set
-- forward_mode, set direct_http_url, and (run later, at teardown) clear
-- direct_http_url.
--
-- Manual proof tooling only: the future managed-server platform service
-- writes these columns itself, on launch and on teardown, the way it will
-- actually work in production. This file needs an operator running it
-- with a Supabase service-role connection against the production
-- database — there is no API for either column (both are OPERATOR-ONLY /
-- NEVER USER-FACING; see the schema comment on
-- pilely_registered_pile.direct_http_url) and no monorepo tooling makes
-- that connection for you.
--
-- Fill in :'pile_id' and :'box_private_ip' (psql \set, or a plain string
-- replace) before running statements 1-2. The convention for a
-- managed_http endpoint is "http://<box private ip>:8080" (the column's
-- own doc comment).

-- 1. Point the row at 'managed_http'. `register_pilely_pile` always
--    writes the 'tunnel' default, so a freshly registered app needs this
--    even though this family's app never runs any other mode afterward.
UPDATE pilely_registered_pile
SET forward_mode = 'managed_http'
WHERE id = :'pile_id';

-- 2. Set the endpoint to the box just launched.
UPDATE pilely_registered_pile
SET direct_http_url = 'http://' || :'box_private_ip' || ':8080'
WHERE id = :'pile_id';

-- 3. Teardown: clear the endpoint, leaving forward_mode at 'managed_http'
--    — the resting state of a managed_http pile with no box running (the
--    origin then answers the hosted-offline envelope, never a 500). Run
--    this on its own, after the instance backing box_private_ip above has
--    been terminated.
UPDATE pilely_registered_pile
SET direct_http_url = NULL
WHERE id = :'pile_id';
