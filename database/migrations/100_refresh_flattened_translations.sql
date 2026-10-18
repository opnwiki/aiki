-- Older machine translations of replies lost their Markdown structure (a
-- reply with headings and lists came back as one paragraph) or still carry
-- text the reply no longer has (leading Fediverse mentions). They are
-- dropped and recreated by the current translator when the page is read.
DELETE FROM reply_translations translation
 USING replies reply
 WHERE translation.reply_id = reply.id
   AND (
     (length(reply.body_markdown) - length(replace(reply.body_markdown, chr(10), '')) >= 2
      AND position(chr(10) IN translation.body_markdown) = 0)
     OR (translation.body_markdown LIKE '@%' AND reply.body_markdown NOT LIKE '@%')
   );
