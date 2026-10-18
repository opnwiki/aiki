-- Vulnerability scanners used browser User-Agents and were counted as people.
-- Reclassify every visit, on the same day, of a visitor that requested a probe
-- path (CMS logins, PHP files, secrets, VCS metadata). Same pattern as
-- isProbePath in server/utils/site-analytics.js.
UPDATE site_visit_analytics visit
   SET visitor_kind = 'bot', client_label = 'Scanner'
  FROM (
    SELECT DISTINCT visitor_date, visitor_hash
      FROM site_visit_analytics
     WHERE path ~* '(?:^|\/)(?:wp-(?:admin|login|content|includes|json|config|cron|signup|trackback|mail)[^/]*|wordpress|xmlrpc\.php|phpmyadmin|pma|cgi-bin|vendor\/phpunit|boaform|hnap1|actuator|\.env[^/]*|\.git|\.svn|\.hg|\.aws|\.ssh|\.ds_store|\.htaccess|\.htpasswd|credentials|config\.(?:json|ya?ml|php)|server-status|server-info|adminer|_profiler|phpinfo|containers|xwiki|reportserver|admingui|airflow|albatross)(?:\/|$)|(?:docker-compose|secrets|database|aws|parameters|application|settings|config)[^/]*\.ya?ml$|\.(?:php\d?|asp|aspx|jsp|cgi|env|ini|bak|sql|old|swp)$'
  ) probe
 WHERE visit.visitor_date = probe.visitor_date
   AND visit.visitor_hash = probe.visitor_hash
   AND (visit.visitor_kind = 'human' OR visit.client_label = 'Other');
