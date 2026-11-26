-- Orders: what a delivery costs when the basket is under min_free_delivery ("Сколько приготовить денег"). Additive only.
ALTER TABLE suppliers ADD COLUMN delivery_fee INTEGER; -- main units; NULL = not known (never guessed, never added)
