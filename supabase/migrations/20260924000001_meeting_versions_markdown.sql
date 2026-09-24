-- Add markdown_content to meeting_versions so the EasyMDE editor can revert
-- to prior versions cleanly. Nullable — old versions (saved by the Quill editor)
-- have html_content only; new versions have both.

ALTER TABLE meeting_versions ADD COLUMN markdown_content TEXT;
