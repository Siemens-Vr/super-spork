# Kenyan institution directory

`kenyan-institutions.json` is a versioned snapshot of the Wikipedia directory supplied for this project. It records the source revision, retrieval date, original names, cleanup decisions, and excluded ambiguous/out-of-country entries.

The 313 directory entries include universities, university colleges, technical/vocational institutions, and other colleges/training providers. Repeated sections, obvious name variants, and campus entries are consolidated. Original names and selected abbreviations become searchable aliases. Types are UI groupings; `offersTvet` records inclusion in the source's TVET section and is not a current licensing assessment. Directory inclusion does not certify accreditation, operating status, or the validity of any qualification. Review against CUE/TVETA and the institution itself when maintaining the catalogue.

The seed preserves existing institution IDs, documents, names, websites, and inactive status. It fills unknown types/missing source references, adds aliases, and never deletes institutions. Ambiguous matches to multiple existing records abort the transaction for review. Applicants' typed institution names remain on their documents and are not automatically added to the directory.

Run `npm run db:migrate`, `npm run db:generate`, and `npm run db:seed:institutions` from `Backend` to install/update the directory. The normal `npm run db:seed` also includes this catalogue. Repeating the institution seed does not create duplicate rows.

## Engineering industry catalogue

`engineering-industries.json` contains the 27 industry names and descriptions agreed for Mechanical, Mechatronic, Electrical and Electronic, and Civil Engineering applicants. It is an application catalogue, not an official industry classification or a restriction on which courses can enter each industry. Careers and companies can link to multiple industries through the existing join tables.

Run `npm run db:seed:industries` to add these industries without running other seeds. The main `npm run db:seed` includes them as well. Both use the unique industry name to avoid duplicates. Existing records, descriptions, inactive status and relationships are preserved, including earlier catalogue entries. This seed does not rename, merge, delete or deactivate older industries. New entries are active by default and appear through `GET /api/v1/industries`; use pagination or `limit=100` to retrieve the full list.

## East African company catalogue

`east-african-companies.json` contains 40 curated employers reviewed on 2026-11-09: 32 in Kenya, four in Uganda, two in Tanzania and two in Rwanda. Every entry records its description, website, country, source URLs and industry names. Mappings cover all 27 agreed industries and describe relevant business activities; they are application classifications, not official industry codes. Country identifies the listed entity or regional headquarters, not every country where a group operates. The directory includes public utilities and KIRDI, a public research institute, because applicants may choose these employers too. It is an initial selection, not an exhaustive register of East African employers or a vacancy feed.

Run `npm run db:seed:companies` from `Backend`, or use the main `npm run db:seed`. The standalone command also creates missing engineering industries. All changes run in a transaction. Existing company names are matched ignoring case and repeated whitespace; ambiguous existing matches abort for review. Existing IDs, fields, inactive status, assessment links and additional industry links are preserved. Missing industry links are added once. Material name changes require an explicit catalogue review rather than speculative merging. Repeating the seed creates no duplicate companies or links. Existing demonstration entries are preserved, but fresh databases receive the real employer catalogue instead of a fictional company.

Sources are retained here for maintenance rather than returned as company fields. Review company status, names and mappings before changing the snapshot. Inclusion does not imply a partnership, recruitment opportunity, employer endorsement or approved competency framework. This seed creates no company-specific assessment requirements; those need their own reviewed framework definitions. The existing authenticated `GET /api/v1/companies` supports name search, industry filtering and pagination for Swagger and frontend selectors.
