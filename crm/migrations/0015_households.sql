-- Several hunters on one Hunt: contacts and dossiers belong to the hunter who made them, useful links added by a hunter who
-- is not an admin stay in that hunter's projects.

ALTER TABLE contacts ADD COLUMN owner_id TEXT;
UPDATE contacts SET owner_id = COALESCE(
  (SELECT s.owner_id FROM listing_contacts lc JOIN listings l ON l.id=lc.listing_id JOIN searches s ON s.id=l.search_id WHERE lc.contact_id=contacts.id ORDER BY s.created_at LIMIT 1),
  (SELECT s.owner_id FROM threads t JOIN searches s ON s.id=t.search_id WHERE t.contact_id=contacts.id ORDER BY s.created_at LIMIT 1),
  (SELECT s.owner_id FROM house_contacts h JOIN searches s ON s.id=h.search_id WHERE h.contact_id=contacts.id ORDER BY s.created_at LIMIT 1),
  (SELECT s.owner_id FROM messages m JOIN searches s ON s.id=m.search_id WHERE m.contact_id=contacts.id ORDER BY s.created_at LIMIT 1),
  (SELECT s.owner_id FROM drafts d JOIN searches s ON s.id=d.search_id WHERE d.contact_id=contacts.id ORDER BY s.created_at LIMIT 1),
  (SELECT s.owner_id FROM people_notes n JOIN searches s ON s.id=n.search_id WHERE n.contact_id=contacts.id ORDER BY s.created_at LIMIT 1),
  (SELECT user_id FROM hunters WHERE is_admin=1 ORDER BY created_at LIMIT 1));
CREATE INDEX contacts_owner ON contacts(owner_id);

-- The same phone number may be in two hunters' contacts. Within one hunter the code keeps it unique.
CREATE TABLE contact_channels_new (
  contact_id    TEXT NOT NULL REFERENCES contacts(id),
  channel       TEXT NOT NULL,
  address       TEXT NOT NULL,
  display       TEXT,
  PRIMARY KEY (contact_id, channel, address)
);
INSERT INTO contact_channels_new (contact_id, channel, address, display) SELECT contact_id, channel, address, display FROM contact_channels;
DROP TABLE contact_channels;
ALTER TABLE contact_channels_new RENAME TO contact_channels;
CREATE INDEX contact_channels_address ON contact_channels(address, channel);

ALTER TABLE dossiers ADD COLUMN owner_id TEXT;
UPDATE dossiers SET owner_id = COALESCE(
  (SELECT s.owner_id FROM json_each(COALESCE(dossiers.listing_ids,'[]')) j JOIN listings l ON l.id=j.value JOIN searches s ON s.id=l.search_id ORDER BY s.created_at LIMIT 1),
  (SELECT user_id FROM hunters WHERE is_admin=1 ORDER BY created_at LIMIT 1));
CREATE INDEX dossiers_owner_id ON dossiers(owner_id);

-- 1 = everyone in the country sees it (an admin added or approved it), 0 = only the projects of the hunter it came from.
ALTER TABLE useful_links ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
UPDATE useful_links SET shared=1 WHERE status='approved';
