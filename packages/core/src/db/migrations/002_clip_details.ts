/**
 * Migration 2: clips become editable review objects (title, description, telestrator
 * drawings). Drawings are opaque JSON to the core; the desktop defines their shape.
 */
export const version = 2;
export const name = 'clip_details';
export const sql = `
ALTER TABLE clips ADD COLUMN title TEXT;
ALTER TABLE clips ADD COLUMN description TEXT;
ALTER TABLE clips ADD COLUMN drawings_json TEXT NOT NULL DEFAULT '[]';
`;
