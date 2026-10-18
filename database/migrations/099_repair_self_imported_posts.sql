-- Re-reading remote threads imported this node's own posts back: @ask answers
-- became duplicate replies by a fake "remote" author, and reply objects
-- written here were handed to a fake remote twin of their author, so a later
-- reply to them was sent to that twin instead of the thread.
WITH home AS (SELECT domain FROM nodes WHERE is_home LIMIT 1)

-- 1. Duplicates: replies created from our own objects.
, duplicates AS (
  UPDATE replies reply
     SET status = 'deleted', updated_at = now()
    FROM home
   WHERE reply.author_id IS NULL
     AND reply.status = 'published'
     AND reply.federation_object_uri LIKE 'https://' || home.domain || '/%'
  RETURNING reply.id
)
UPDATE federation_objects object
   SET state = 'deleted', updated_at = now()
  FROM duplicates
 WHERE object.reply_id = duplicates.id;

-- 2. Our reply objects go back to their real local actor (@anon for -anon copies).
UPDATE federation_objects object
   SET actor_id = coalesce(
         CASE WHEN object.object_uri LIKE '%-anon'
              THEN (SELECT anon.id FROM federation_actors anon WHERE anon.is_local AND anon.purpose = 'anon' LIMIT 1) END,
         (SELECT author.id FROM federation_actors author WHERE author.is_local AND author.local_actor_id = reply.author_id LIMIT 1)),
       updated_at = now()
  FROM replies reply, federation_actors owner, nodes home
 WHERE home.is_home
   AND object.reply_id = reply.id
   AND reply.author_id IS NOT NULL
   AND owner.id = object.actor_id AND owner.is_local = false
   AND object.object_uri LIKE 'https://' || home.domain || '/ap/objects/notes/replies-%';

-- 3. Deliveries aimed at our own (twin) actors are redone from scratch.
WITH home AS (SELECT domain FROM nodes WHERE is_home LIMIT 1),
broken AS (
  DELETE FROM federation_reply_deliveries delivery
   USING home
   WHERE delivery.target_actor_uri LIKE 'https://' || home.domain || '/%'
  RETURNING delivery.reply_id
)
UPDATE replies reply
   SET federation_object_uri = NULL, federation_activity_uri = NULL, federation_delivery_state = 'none'
  FROM broken
 WHERE reply.id = broken.reply_id;

-- 4. Fake remote twins of local accounts and channels are retired.
UPDATE federation_actors actor
   SET status = 'deleted', updated_at = now()
  FROM nodes home
 WHERE home.is_home AND actor.is_local = false
   AND (actor.domain = home.domain OR actor.actor_uri LIKE 'https://' || home.domain || '/%');
