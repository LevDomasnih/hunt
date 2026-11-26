-- Wave 8.1: a short house name for home-mode titles ("Дом в Унгасане" instead of the long listing title).
-- Set by the agent (PATCH /api/listings/:id short_name, MCP listing_update) or the search owner in the Mini App.
-- Additive only; NULL = the Mini App falls back to "Дом в <district>" / "Дом".
ALTER TABLE listings ADD COLUMN short_name TEXT;
