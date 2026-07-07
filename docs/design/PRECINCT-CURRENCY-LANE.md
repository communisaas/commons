# Precinct Currency Lane — per-state current-precinct overlays

**Status**: Adversarially verified survey (all 51 jurisdictions independently re-checked, as-of 2026-07)
**Scope**: 50 states + DC, hunting a STATEWIDE, openly published precinct/ward/VTD boundary file that is UPDATED between censuses
**Companion docs**: `SELF-HEALING-DATA-OPS.md` (source registry / SLO / probe machinery these rows plug into), `MISSING-SLOTS-SOURCING.md`

---

## 1. The honest national picture

**VTDs are a decennial Census product.** The only *national* precinct-equivalent layer
is the Census Bureau's Voting Tabulation Districts as captured in the **TIGER 2020
PL 94-171 release** — a snapshot of state-submitted precinct approximations frozen at
the 2020 redistricting cycle. The next national refresh is **2030**. No vendor sells a
compliant, current, national precinct file; academic stitch-togethers (VEST, MGGG,
Redistricting Data Hub) are research compilations with per-state vintages and
research-grade licensing, not a serving-grade national product.

**Currency therefore only exists as per-state overlays.** A minority of states operate
a genuine statewide precinct/ward clearinghouse that updates between censuses —
Wisconsin's LTSB (statutorily semiannual) is the archetype. Where such a source exists,
verified, and openly licensed, we can serve *current* precinct geometry for that state.
Where it does not, the 2020 baseline is the honest best available, and we say so.

**Serving contract (non-negotiable):**

1. The overlay **never replaces** the TIGER 2020 baseline. The baseline stays intact
   and nationally uniform; overlays layer on top per state.
2. **Every served district carries its vintage + source in provenance** (per
   `src/lib/core/shadow-atlas/provenance.ts` conventions): a lookup answered from the
   Wisconsin overlay says `WI LTSB, Feb 2026 collection`; a lookup answered from the
   baseline says `Census TIGER 2020 PL`. No silent blending, no implied currency where
   there is none.
3. Overlay sources enter the ingest path **only at verdict CONFIRMED** (statewide scope
   + license text observed + post-2022 update evidence independently re-fetched).
   PLAUSIBLE rows are follow-up work, not ingest candidates.

**Survey result**: **23 CONFIRMED / 4 PLAUSIBLE / 24 NONE / 0 UNSWEPT** (51 total, no
jurisdiction skipped). The 23 CONFIRMED states cover **≈168.7M people — 50.9% of the
2020 US resident population**. Every row below was re-verified by an independent
verifier against the original hunter's claims; corrections and downgrades from that
adversarial pass are recorded inline.

---

## 2. Per-state disposition — all 51 jurisdictions

Order: CONFIRMED (23) → PLAUSIBLE (4) → NONE (24) → UNSWEPT (0).

### Index

| State | Verdict | Portal (short) | Cadence | Format |
|---|---|---|---|---|
| AR | CONFIRMED | Arkansas GIS Office (ASDI) | rolling, county-by-county, near-continuous | shapefile / ArcGIS FeatureServer |
| CA | CONFIRMED | UC Berkeley Statewide Database (SWDB) | per-statewide-election | shp / gpkg / geojson |
| HI | CONFIRMED | Hawaii Statewide GIS + Office of Elections | per-election-cycle | ArcGIS MapServer/FeatureServer + exports |
| ID | CONFIRMED | Idaho SOS + ITS (The Idaho Map) | biennial (even years, statutory Jan 15 submission) | ArcGIS FeatureServer + exports |
| IN | CONFIRMED | Indiana GIO / IndianaMap | annual | ArcGIS FeatureServer + shapefile |
| IA | CONFIRMED | Iowa SOS + Legislative Services Agency | decennial baseline + corrections | ArcGIS FeatureServer + per-county shapefile |
| MD | CONFIRMED | MD iMap (MDP + State Board of Elections) | rolling re-collection per cycle | ArcGIS FeatureServer + exports |
| MA | CONFIRMED | MassGIS (Secretary of the Commonwealth data) | irregular, event-driven | Feature Service + shapefile/FGDB |
| MI | CONFIRMED | MI Dept. of State / Bureau of Elections | per-even-year election cycle | ArcGIS Hub + shp/geojson/csv |
| MT | CONFIRMED | Montana State Library (MSDI) | as-needed | FGDB + shapefile + MapServer |
| NH | CONFIRMED | NH GRANIT (UNH) | as-needed (per-redistricting in practice) | shapefile (FTP) + Feature Service |
| NM | CONFIRMED | NM SOS clearinghouse (UNM EDAC/RGIS) | as-needed, county-triggered | shp/GML/KML/GeoJSON/CSV/Excel |
| NY | CONFIRMED | NYS GIS Clearinghouse / ITS | rolling/irregular | ArcGIS Feature Service + exports |
| NC | CONFIRMED | NC State Board of Elections (dl.ncsbe.gov) | irregular, ~2-4×/year | shapefile (S3) + Feature Service |
| ND | CONFIRMED | ND Secretary of State | per-election-cycle | ZIP (FGDB + Excel) |
| RI | CONFIRMED | RIGIS (for RI Dept. of State) | per-redistricting base + ad-hoc edits | Esri hosted feature layer |
| SC | CONFIRMED | SC Revenue & Fiscal Affairs Office | irregular bursts, running "Effective" date | shapefile + KMZ |
| TX | CONFIRMED | Texas Legislative Council (Capitol Data Portal) | per-election-cycle | shapefile |
| UT | CONFIRMED | UGRC (VISTA Ballot Areas, SGID) | rolling, as-needed | ArcGIS FeatureServer + exports |
| VT | CONFIRMED | VCGI + VT Secretary of State | irregular (municipal redraws) | ArcGIS FeatureServer + exports |
| WA | CONFIRMED | WA SOS via geo.wa.gov | annual (per general election) | Feature Service + yearly statewide ZIP |
| WI | CONFIRMED | WI Legislature LTSB GIS Hub | semiannual, statutory (Wis. Stat. 5.15(4)(br)1) | Feature Service + full export set |
| DC | CONFIRMED | Open Data DC (DC GIS + Board of Elections) | event-driven; current layer refreshed 2026-06 | FeatureServer/MapServer + shp/geojson/kml/csv |
| AK | PLAUSIBLE | AK DCCED/DCRA Geoportal (Division of Elections data) | irregular | ArcGIS Feature/MapServer |
| DE | PLAUSIBLE | Delaware FirstMap / Dept. of Elections GIS | irregular / event-driven | ArcGIS FeatureServer + shapefile |
| LA | PLAUSIBLE | LA Legislature redistricting site | semiannual (per search evidence) | shapefile |
| MN | PLAUSIBLE | MN SOS via MN Geospatial Commons | irregular (per unverified snippets) | shp/KML/GeoJSON (unverified) |
| AL | NONE | AL Secretary of State | n/a | — |
| AZ | NONE | AZ SOS / Independent Redistricting Commission | n/a | — |
| CO | NONE | CO Geospatial Portal / SOS | n/a | — |
| CT | NONE | CT OPM GIS / UConn MAGIC | n/a | — |
| FL | NONE | FL Division of Elections / FGDL | n/a | — |
| GA | NONE | GA SOS / Reapportionment Office / GIO | n/a | — |
| IL | NONE | IL State Board of Elections | county PDF maps only | PDF |
| KS | NONE | KS Geoportal (KLRD data) | frozen between censuses | ArcGIS Hub item |
| KY | NONE | KyGeoNet / LRC | n/a | — |
| ME | NONE | ME "Voting Districts" = legislative seats, not precincts | n/a | — |
| MS | NONE | MARIS (partial: 13/82 counties) | n/a | county shapefiles |
| MO | NONE | MO SOS / MSDIS | n/a | — |
| NE | NONE | NE SOS / NebraskaMAP | n/a | — |
| NV | NONE | NV SOS county-precinct-maps index | biennial submissions, PDF republish | PDF per county |
| NJ | NONE | NJOGIS (layers frozen, "MATURE SUPPORT") | frozen | frozen Feature Service |
| OH | NONE | none (county statutory duty, ORC 3501.05) | n/a | — |
| OK | NONE | okmaps.org (2022-01-01 static statewide file) | static, no re-issuance | shapefile (stale) |
| OR | NONE | data.oregon.gov (tabular crosswalk only) | n/a | tabular only, no geometry |
| PA | NONE | PA LRC / redistricting.state.pa.us | one-time 2021 product | shapefile (2021, never refreshed) |
| SD | NONE | none | n/a | — |
| TN | NONE | TN Comptroller (per-county maps) | per-county | PDF/KMZ per county |
| VA | NONE | VA Dept. of Elections GIS page | rolling per-locality, no statewide file | 134+ locality ZIPs |
| WV | NONE | WV GIS Technical Center (county layers only) | n/a | — |
| WY | NONE | WY Geospatial Hub (county layers only) | n/a | — |

**UNSWEPT: none — 0 jurisdictions.** All 50 states + DC were swept and dispositioned.

---

### 2.1 CONFIRMED (23) — full records

Every CONFIRMED row has (a) statewide scope, (b) license text as actually observed,
and (c) post-2022 update evidence **independently re-fetched by a second verifier**
against the primary source (REST JSON, FTP listings, S3 APIs, or archived captures —
not search snippets).

#### AR — Arkansas
- **Portal**: Arkansas GIS Office (Dept. of Shared Administrative Services), publishing on behalf of the Arkansas Secretary of State — Arkansas Spatial Data Infrastructure (ASDI)
- **URL**: https://gis.arkansas.gov/product/election-precincts/ · metadata: https://gis.arkansas.gov/Metadata/HTML/asdi.Boundaries.ELECTION_PRECINCTS_export.html · REST: https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Boundaries/FeatureServer/11
- **Format**: shapefile / ArcGIS FeatureServer (REST independently queried via `f=pjson`)
- **Cadence**: rolling/near-continuous county-by-county updates folded into a single statewide layer
- **License (verbatim, from the metadata HTML page, fetched directly)**: "Credits: There are no credits for this item. Use limitations: There are no access and use limitations for this item."
- **Post-2022 evidence (independently re-fetched)**: site search surfaced dated 2025–2026 county-update posts — Conway (6/16/2026), Marion (6/11/2026), Woodruff (6/8/2026), Polk (6/3/2026), Lonoke (5/29/2026), Searcy (5/26/2026), Clark (4/30/2026), Benton (2/9/2025), Carroll/Stone/Washington (11/21/2025). The 11/24/2025 post explicitly states "The updated statewide layer is available through the Arkansas Spatial Data Infrastructure (ASDI)". Product page shows "Updated: 2026-06-17 08:00:00".
- **Caveats**: two metadata surfaces carry STALE boilerplate contradicting the rolling evidence — the metadata HTML says "Last updated on August 8, 2019" and the REST layer description says the data "was generated following the release of the 2010 Census data and was finalized in 2012." These are legacy static-text fields never refreshed as polygons kept being edited per-county. Do not cite an exact "as-of" date from those fields.

#### CA — California
- **Portal**: California Statewide Database (SWDB), UC Berkeley School of Law — California's *de facto* statewide precinct/VTD clearinghouse (UC-operated, **not a state agency**)
- **URL**: https://statewidedatabase.org/election.html · most recent geography: https://statewidedatabase.org/d20/g24_geo_conv.html (2024 General; 2025 Special also listed)
- **Format**: shapefile (.shp), GeoPackage (.gpkg), GeoJSON — statewide MPREC/SRPREC files confirmed present alongside per-county files for all 58 counties
- **Cadence**: per-election — a new statewide precinct-boundary release accompanies every statewide election (primary, general, special)
- **License (as actually observed)**: only independently confirmable text is the site-wide footer: "© 2000-2026 UC Regents. All Rights Reserved. University of California, Berkeley." **Correction from the adversarial pass**: the hunter's quoted "free public resource" FAQ text could NOT be re-located; no formal open-data license (CC-BY etc.) is stated anywhere verifiable. **Treat the license as effectively "not stated" beyond bare copyright.**
- **Post-2022 evidence (independently re-fetched)**: direct fetch of election.html — most recent entry is 2025 Special Election ("GEOGRAPHIC DATA: Special Election Precinct Boundaries"); preceding entry 2024 Primary/General. Direct fetch of g24_geo_conv.html confirms statewide `MPREC_SHP` / `SRPREC_SHP` downloads.
- **Caveats**: license gap is the blocking issue for signed republication — needs a rights confirmation from SWDB before ingest ships publicly (see §3). SWDB is the standard citation used by the Census VTD program and Redistricting Data Hub.

#### HI — Hawaii
- **Portal**: Hawaii Statewide GIS Program (Office of Planning and Sustainable Development) + Hawaii Office of Elections — layer "Election Precincts - 2024" on geodata.hawaii.gov
- **URL**: https://geodata.hawaii.gov/arcgis/rest/services/AdminBnd/MapServer/13
- **Format**: ArcGIS FeatureServer/MapServer (exportable as shapefile/geojson via geoportal.hawaii.gov)
- **Cadence**: irregular/per-election-cycle — a new dated layer ahead of each general election (2022 edition superseded by 2024)
- **License (verbatim, confirmed word-for-word on https://planning.hawaii.gov/gis/download-gis-data/ — NOT the generic ehawaii.gov Terms of Use the original citation implied)**: "The contents of this web page are public domain and to the extent indicated otherwise in the Terms of Use, are exempt from Terms of Use policy restrictions... There are no expressed warranties associated with the release of this data or product. Specifically, no warranty is made that the GIS data or any subsequent updates will be error free and no warranty is made regarding the positional or thematic accuracy of the GIS data... The GIS data and any features depicted do not represent or confer any legal rights, privileges, benefits, boundaries or claims of any kind."
- **Post-2022 evidence (independently re-fetched)**: AGOL item 37f83ac7f930421b97976956cccbd840 JSON — description "Voting Precincts in Hawaii for 2024 elections from the State Office of Elections (May 2024)"; modified epoch 1716938720000 = 2024-05-28. Live layer query `returnCountOnly` = exactly 250 precincts statewide (all 4 counties), fields include us_house/state_house/state_senate/county_council + precinct ids.
- **Caveats**: license URL pointer in the original report was wrong (corrected above); the text itself and the verdict are solid.

#### ID — Idaho
- **Portal**: Idaho Secretary of State + Idaho Office of Information Technology Services (ITS), via The Idaho Map (TIM) / AGOL org state_of_idaho
- **URL**: https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Idaho_Voting_Precincts_Precinct_Boundaries_-_Master_Data_-_DO_NOT_SHARE_view/FeatureServer
- **Format**: ArcGIS FeatureServer (view service, layer 0), exports via The Idaho Map hub
- **Cadence**: biennial, statutory — item snippet: "Data is updated in even years before state primary and general elections." County Clerks submit to SOS by Jan 15 of election years.
- **License (verbatim via direct AGOL item JSON, item 0b4fbe4f3104487da8bc5087f9321705; condensed rendering — substance matches the hunter's fuller quote)**: "Neither the Idaho Secretary of State nor the State of Idaho assumes legal responsibility for accuracy or completeness. Users requiring verified information for official purposes should confirm data with primary sources."
- **Post-2022 evidence (independently re-fetched)**: item JSON contentStatus `public_authoritative`, modified epoch 1780083781000 = **2026-05-29**. Live FeatureServer/0 `returnCountOnly` = exactly 976 precincts. Full statewide extent (WKID 102605).
- **Caveats**: "DO_NOT_SHARE" in the service name is an internal naming artifact of the source view — the service resolves publicly and returns full data anonymously (confirmed by direct query). Worth a courtesy confirmation with ID SOS before republication, given the name.

#### IN — Indiana
- **Portal**: Indiana Geographic Information Office (GIO) / IndianaMap, sourced from the Indiana General Assembly and Indiana Election Division
- **URL**: https://gisdata.in.gov/server/rest/services/Hosted/Voting_District_Boundaries_2024/FeatureServer (single layer at **id=1**)
- **Format**: ArcGIS FeatureServer + shapefile export via IndianaMap hub
- **Cadence**: annual — "Updated annually by Indiana General Assembly through aggregated local data." Prior editions (2020, 2023) exist in the same AGOL org, corroborating a genuine annual series.
- **License (via direct AGOL item JSON, item a62a17919c804676ae318f2f82cb20db; condensed rendering — substance matches)**: "Product provided \"AS IS\" without warranties. User assumes all risk. Indiana Geographic Information Office disclaims liability for indirect, incidental, special, or consequential damages."
- **Post-2022 evidence (independently re-fetched)**: item modified epoch 1780335760000 = **2026-06-01**. Live `returnCountOnly` on layer 1 = exactly **5,126** voting-district polygons. Snippet names "election district, precincts, or wards" — precinct-level, not legislative districts. Full statewide extent confirmed.

#### IA — Iowa
- **Portal**: Iowa Secretary of State + Iowa Legislative Services Agency (LSA); "Iowa_Precincts" feature service, surfaced on geodata.iowa.gov and sos.iowa.gov
- **URL**: https://services.arcgis.com/vPD5PVLI6sfkZ5E4/arcgis/rest/services/Iowa_Precincts/FeatureServer
- **Format**: ArcGIS FeatureServer (layer 0); per-county shapefiles on sos.iowa.gov
- **Cadence**: **decennial baseline (2022 reprecincting) + incidental corrections — NOT a regular sub-decennial refresh.** Snippet: "Iowa Precincts - as of the 2022 Reprecincting."
- **License**: not stated — confirmed exactly: item d394edea208c4003ac1d6bd1ec78532f JSON has `licenseInfo: null`, `description: null`; only accessInformation credit "Iowa Secretary of State, Iowa Legislatives Services Agency".
- **Post-2022 evidence (independently re-fetched)**: item modified epoch 1706643378000 = 2024-01-30; separate dataLastEditDate 1706896912686 = 2024-02-02 — both real, distinct timestamps evidencing a correction event after the 2022 snapshot. Live `returnCountOnly` = exactly 1,660 precincts. Extent matches Iowa's bounding box exactly.
- **Caveats**: license absent (flag for signed-republication review); cadence caveat must be preserved in provenance — this is a 2022-reprecincting product with corrections, not an annually refreshed file.

#### MD — Maryland
- **Portal**: Maryland Dept. of Planning (MDP) + State Board of Elections (SBOE), via MD iMap
- **URL**: https://mdgeodata.md.gov/imap/rest/services/Boundaries/MD_ElectionBoundaries/FeatureServer/2
- **Format**: ArcGIS FeatureServer (service capabilities list shapefile/FGDB/SQLite/CSV/GeoJSON export; export capability itself not separately re-tested)
- **Cadence**: rolling/as-needed statewide re-collection tied to election cycles — description states data "were collected by the State Board of Elections (SBOE) in 2025 and aggregated by the Maryland Department of Planning (MDP)"
- **License**: PARTIALLY verified. Layer/service `copyrightText` is a short credit string only. The full MDP/MD-iMap disclaimer ("as is" without warranty; user "assumes the entire risk"; "freely distributed as long as the metadata entry is not modified"; "acknowledge the State of Maryland") is corroborated by independent search as genuine standard MDP boilerplate but was **not observed rendered on this specific endpoint**. Treat as corroborated-but-not-page-sourced; CONFIRMED-with-caveat on the license field only.
- **Post-2022 evidence (independently re-fetched)**: layer JSON — name "Maryland Precincts 2026", "Last Updated: 1/12/2026" verbatim; independent `returnCountOnly` = **2,091** precincts statewide.
- **Caveats**: Howard County still reflects 2022 boundaries (no 2025 submission) — per-county vintage variance must flow into provenance.

#### MA — Massachusetts
- **Portal**: MassGIS (Bureau of Geographic Information, EOTSS); data from MA Secretary of the Commonwealth's Elections Division
- **URL**: https://gis.data.mass.gov/datasets/massgis::wards-and-precincts-2022
- **Format**: ArcGIS Feature Service + downloadable shapefile/File Geodatabase via MassGIS Data Hub
- **Cadence**: irregular/event-driven — updated when LEDRC approves new municipal ward-precinct plans or legislative corrections occur
- **License (verbatim, read directly in the MassGIS DCAT-US JSON record)**: "This GIS web service is a public resource and may be used by anyone for their purposes. The data are public records and are based on the most up to date information at the time of publication. The information contained in this service is NOT to be construed or used as a \"legal description.\" MassGIS, EOTSS and the Commonwealth of Massachusetts are not liable for errors, inaccuracies or omissions and shall be held harmless from and against all damage, loss or liability arising from any use of geospatial data that is shared. When using MassGIS data on maps or in digital applications, source credit should be stated as \"MassGIS (Bureau of Geographic Information), Commonwealth of Massachusetts EOTSS\"."
- **Post-2022 evidence (independently re-fetched)**: parsed the DCAT-US 1.1 feed (3,425 records) directly — record "Wards and Precincts (2022)": issued 2023-06-29, **modified 2024-02-21**, publisher "MA Secretary of the Commonwealth". Companion Feature Service record (id 6d4ae7efad4f4c77907db7cbfb012e64) also modified 2024-02-21.
- **Caveats**: statewide = cities (wards+precincts) + towns (precincts only), one layer. The Feb-2024 modification is itself ~2.3 years old; no 2025/2026 statewide re-release found in the feed. Post-2022 test passes, but "current" here means 2022-plan vintage with 2024 corrections.

#### MI — Michigan
- **Portal**: Michigan Dept. of State, Bureau of Elections, via State of Michigan GIS Open Data (Center for Shared Solutions, DTMB)
- **URL**: https://gis-michigan.opendata.arcgis.com/datasets/Michigan::2024-voting-precincts
- **Format**: ArcGIS Hub Feature Service + shapefile/GeoJSON/CSV download
- **Cadence**: per-even-year election cycle — live items for 2014, 2016, 2018, 2020, 2022, 2024, and 2026 confirmed under the same `michigan_admin` owner
- **License (verbatim, leading text)**: "This dataset is a public record and, as more fully described below, there are no restrictions on the use, reproduction, or distribution of this dataset. Notwithstanding the foregoing, the public release of this dataset should not be construed, expressed or implied, as to whether any use constitutes a legally permissible purpose. It is the sole responsibility of the user to determine if the data is usable for their purposes. This dataset is provided \"AS IS\" and on an \"AS AVAILABLE\" basis. The State of Michigan (\"State\") makes no warranties, express or implied, regarding the accuracy, adequacy, reliability, timeliness, or completeness of this dataset..." (attribution: "Michigan Department of State; Bureau of Elections. Center for Shared Solutions, Department of Technology, Management, and Budget, State of Michigan")
- **Post-2022 evidence (independently re-fetched, WITH CORRECTION)**: the hunter's cited item id was actually the "2026 Voting Precincts" item flagged `deprecated`. The true "2024 Voting Precincts" item is **02d40893317d46569017beeb14f9c63e**: created 2024-09-11, modified 2026-04-13, contentStatus active. A live, non-deprecated 2026 item also exists — the 2024 vintage is not the newest cycle.
- **Caveats**: publisher-acknowledged: "validation done by most, but not all jurisdictions"; "the data set is only as good as the information received from the local election official." Ingest should target the newest active cycle item at fetch time, not a pinned year.

#### MT — Montana
- **Portal**: Montana State Library (MSL) — MSDI Administrative Boundaries Framework, with the MT Secretary of State
- **URL**: https://msl.mt.gov/geoinfo/msdi/administrative_boundaries/ · files: https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/AdministrativeBoundaries/MontanaVotingPrecincts.zip (+ `_shp.zip`) · service: https://gisservice.mt.gov/arcgis/rest/services/msdi_administrative_boundaries_map_v1/MapServer/10
- **Format**: File geodatabase (.zip) + shapefile (`_shp.zip`) + live ArcGIS MapServer layer (id 10, "Voting Precincts")
- **Cadence**: "As needed" (metadata update field); status In work/Complete
- **License (verbatim, verified against live FGDC XML)**: "The Montana State Library Geographic Information Services provides this product/service for informational purposes only. The Library did not produce it for, nor is it suitable for legal, engineering, or surveying purposes. Consumers of this information should review or consult the primary data and information sources to ascertain the viability of the information for their purposes. The Library provides these data in good faith but does not represent or warrant its accuracy, adequacy, or completeness... The Library reserves the right to change or revise published data and/or services at any time." Access Constraints: None; Use Constraints: as quoted.
- **Post-2022 evidence (independently re-fetched)**: FTP listing shows .xml/.zip/_shp.zip all Last-Modified **5/21/2026**; XML Publication Date 20260506; live MapServer/10 description: "updated as part of redistricting in 2023. Thirty-four (34 counties) of the fifty-six (56) counties were updated," citing MCA 13-3-101/102.
- **Caveats**: none material — every element (scope, license, update, live endpoint) independently reproduced.

#### NH — New Hampshire
- **Portal**: NH GRANIT (UNH Earth Systems Research Center) — statewide clearinghouse; "New Hampshire Political Districts (Voting Wards)"
- **URL**: https://new-hampshire-geodata-portal-1-nhgranit.hub.arcgis.com/datasets/NHGRANIT::new-hampshire-political-districts-voting-wards/about · direct: https://ftp.granit.unh.edu/GRANIT_Data/Vector_Data/Administrative_and_Political_Boundaries/d-nhpolitdists/2022/NHPolitDists2022.zip
- **Format**: shapefile (zipped, 1.2–1.3 MB, confirmed downloadable) + hosted Feature Service referenced in metadata
- **Cadence**: `<update>As needed</update>` (status Complete) — irregular; no vintage newer than /2022/ exists in the parent directory
- **License (verbatim, from FGDC metadata XML, independently fetched)**: `<accconst>None</accconst>` and `<useconst>None</useconst>`
- **Post-2022 evidence (independently re-fetched)**: FTP /2022/ files Last-Modified 2023-06-07 through 2023-06-13; FGDC `<pubdate>20230608</pubdate>`, time period 20220908–20230608 (ward data current through Sept 2022, published June 2023 — genuinely post-2022). 327 polygons; fields FIPS/NAME/COUNTY/DISTRICT; credited to "NH Office of Planning and Development, 2022".
- **Caveats**: the hunter's AGOL-Hub "modified 2025-05-11" sub-claim could not be re-verified (JS-only Hub page); CONFIRMED rests on the FTP/XML evidence. Effective cadence is per-redistricting — set staleness expectations accordingly.

#### NM — New Mexico
- **Portal**: NM Secretary of State (statutory clearinghouse under SB304/2021), operated by UNM Earth Data Analysis Center (EDAC) / RGIS
- **URL**: https://www.sos.nm.gov/voting-and-elections/data-and-maps/gis-voting-district-data/ → https://gstore.unm.edu/apps/rgis/datasets/3b1de40a-b37e-4d35-abdd-fd40bbbbe39e/metadata/ISO-19115:2003.html
- **Format**: ZIP / ESRI Shapefile / GML / KML / GeoJSON / JSON / CSV / MS Excel (per Transfer Options on the metadata record)
- **Cadence**: "Maintenance and Update Frequency: As needed" — county-update-triggered
- **License (verbatim, both texts independently confirmed on fetch)**: (1) SOS page: "Users may download the data available from the voting district data clearinghouse for free." (2) EDAC Use Constraints: "Although these data have been processed successfully on a computer system at EDAC, no warranty expressed or implied is made by the EDAC regarding the use of the data on any other system, nor does the act of distribution constitute any such warranty." Access Constraints: "None".
- **Post-2022 evidence (independently re-fetched)**: EDAC metadata — title "New Mexico Voting Precincts July 2024", publication date 2024-07-03, abstract references the Hidalgo Precinct update. Statewide bbox confirmed (-109.05/-103.00/37.00/31.33); 1,939 precinct polygons. SB304 statutory basis confirmed on the SOS page itself.
- **Caveats**: new vintages appear as new dataset UUIDs — change detection should watch the SOS clearinghouse page, not a pinned UUID.

#### NY — New York
- **Portal**: NYS GIS Clearinghouse / NYS ITS Geospatial Services, sourced from NYS Board of Elections + county/NYC BOEs
- **URL**: https://data.gis.ny.gov/datasets/election-districts · service: https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Elections_Districts_and_Polling_Locations/FeatureServer (Election Districts layer; item 23a056702cfd40848deef9597945a998)
- **Format**: hosted ArcGIS Feature Service, exportable shapefile/GeoJSON/CSV/FGDB/KML/Excel/SQLite/GeoPackage
- **Cadence**: rolling/irregular
- **License (verbatim, from item JSON licenseInfo — exact match)**: "The State of New York, acting through the New York State Office of Information Technology Services, makes no representations or warranties, express or implied, with respect to the use of or reliance on the Data provided. The User accepts the Data provided 'as is' with no guarantees that it is error free, complete, accurate, current or fit for any particular purpose and assumes all risks associated with its use. The State disclaims any responsibility or legal liability to Users for damages of any kind, relating to the providing of the Data or the use of it. Users should be aware that temporal changes may have occurred since this Data was created."
- **Post-2022 evidence (independently re-fetched)**: item created epoch 1729618951000 = 2024-10-22, modified epoch 1781652183000 = **2026-06-16**; description states "as of June 2026" for polling data. Statewide extent [-79.997,40.405]–[-71.650,45.023]. Election-district (precinct-equivalent) granularity confirmed, not just legislative districts.

#### NC — North Carolina
- **Portal**: NC State Board of Elections (NCSBE), public S3 bucket dl.ncsbe.gov; mirrored on NC OneMap (CGIA / NC DIT)
- **URL**: https://dl.ncsbe.gov/?prefix=ShapeFiles/Precinct/ · mirror: https://www.nconemap.gov/datasets/nconemap::voting-precincts/about (item 771ae6473a1c4ba3bc768cc2c4b10015)
- **Format**: ESRI shapefile (.zip) on S3 (live-confirmed via S3 REST API); ArcGIS Feature/Map Service with standard exports
- **Cadence**: irregular/as-needed tied to election cycles — full release history enumerated back to 2012 (…20220729, 20220831, 20231220, 20240723, 20250225, 20250728, 20251212) — roughly 2–4×/year recently
- **License**: not stated as extractable dataset-specific text — independently confirmed the NC OneMap terms page is a client-rendered SPA; only the licenseInfo *pointer* (https://www.nconemap.gov/pages/terms) exists in item JSON. Flag for human license review before signed republication.
- **Post-2022 evidence (independently re-fetched)**: direct S3 list-type=2 query — `SBE_PRECINCTS_20251212.zip` LastModified **2026-01-12T16:21:54Z** is the current latest statewide vintage (verified by enumerating the entire history, not cherry-picking). OneMap item modified epoch 1754576431000 = 2025-08-07. Item description verbatim: "It depicts voting precincts for all 100 counties in NC."
- **Caveats**: adjacent VTD/, LegislativeDistricts/, CountyBoundary/ prefixes confirm an ongoing elections-data operation. Cheapest change-detection endpoint in the whole lane (plain S3 listing).

#### ND — North Dakota
- **Portal**: North Dakota Secretary of State, Elections Division
- **URL**: https://www.sos.nd.gov/elections/election-resources · download: https://www.sos.nd.gov/sites/default/files/documents/elections/map-shape-files/voting-shape-files-2026.zip
- **Format**: ZIP containing an Esri File Geodatabase + Excel companion (content-type application/zip, 1.83 MB, HEAD-confirmed)
- **Cadence**: per-election-cycle/irregular; file named for the "2026 election cycle" — sub-annual cadence not established
- **License**: not stated — independently confirmed via direct curl: no license/terms text accompanies the download; only usage instructions: "These files require a shapefile viewing tool to open. If you have this software, use the files to find a precinct from the map and match it up to the corresponding record in the Excel document."
- **Post-2022 evidence (independently re-fetched)**: HTTP HEAD on the live download — `last-modified: Tue, 31 Mar 2026 14:56:29 GMT`; page text: "2026 North Dakota precinct GIS maps and Excel file (zip file)" / "Statewide Polling Places & Precincts (2026 Primary Election)".
- **Caveats**: internal GDB timestamps not inspected (binary tooling out of scope for the pass); license absent — flag for review.

#### RI — Rhode Island
- **Portal**: RIGIS (Rhode Island Geographic Information System), compiled for the RI Dept. of State Elections Division
- **URL**: https://www.rigis.org/datasets/edc::voting-precincts-2022/about (item 9104ca2e5e9b4cdb9985e8935ef2514d)
- **Format**: Esri hosted feature layer, RI State Plane Feet NAD83(2011); 416 features (confirmed via direct `returnCountOnly` query)
- **Cadence**: per-redistricting-cycle base layer (valid "in or after 2022" through 2032) with real ad-hoc edits within the cycle
- **License (verbatim)**: "This dataset is provided 'as is.' The producer(s) of this dataset, contributors to this dataset, the Rhode Island Geographic Information System (RIGIS) consortium, the State of Rhode Island, and the University of Rhode Island do not make any warranties of any kind for this dataset and are not liable for any loss or damage however and whenever caused by any use of this dataset. Please acknowledge both RIGIS and the primary producer(s) of this dataset in any derived products. Versions of the RIGIS logo suitable for both printed and web-based products are available at https://info.rigis.org/pages/logos. This dataset should be used to map elections held in or after 2022. While the precinct numbers may be similar as in elections from 2021 or early, redistricting in 2022 shifted precinct boundaries. To map elections from 2011 through 2021 use the Voting Precinct 2016 file found on RIGIS."
- **Post-2022 evidence (independently re-fetched, stronger than the original citation)**: bypassed the JS-only Hub page and hit the REST item API directly — item modified epoch 1736180289000 = **2025-01-06** (created 2023-11-27); layer `editingInfo.lastEditDate` epoch 1726084871267 = **2024-09-11**. Both directly-observed post-2022 edit timestamps from the authoritative service.
- **Caveats**: the hunter's "Access Constraints: None" phrase was not found on the item JSON (likely from an unlocated FGDC XML) — dropped from this record.

#### SC — South Carolina
- **Portal**: SC Revenue and Fiscal Affairs Office (RFA) — Political GIS Data / Precinct Demographics & Redistricting
- **URL**: https://rfa.sc.gov/programs-services/precinct-demographics/jurisdictional-mapping/political-gis-data
- **Format**: Esri shapefile (statewide, 13,275,292 bytes verified) + KMZ, NAD 1983(2011) State Plane SC feet; DBF header reports **2,310** precinct records statewide; full SC State Plane extent confirmed
- **Cadence**: irregular/as-needed re-issuance under a running "Effective" date label; NOT literally annual — internal process log shows edit bursts (Nov 2023, Jan–Jun 2024, Nov 2024, Jan 2025)
- **License**: not stated on the dataset page — full page text searched for license/terms/disclaimer/copyright/use-constraint; only a generic nav "Privacy and Disclaimers" link. Flag for review.
- **Post-2022 evidence (independently re-fetched, with corrections)**: live rfa.sc.gov times out from datacenter tooling; the verifier pulled the Wayback CDX list (46 captures) and fetched the most recent snapshot (2025-06-03): "SC Voting Precinct Files" / "Statewide Precinct Shapefile (zip 13 MB)" / "SC Voting Precincts Shapefile Effective 1/1/2025" — then **downloaded and unzipped the actual 13.3 MB shapefile** and extracted all 672 dated lineage Process entries, finding genuine edits through 2024-11-18, 2025-01-02, 2025-01-09. **Corrections**: internal file is `SC_VoterPrecincts.shp` (not "2025Precincts.shp"), zip-entry timestamp Jan 10 2025 (not Aug 2025), metadata CreaDate 20230515. The hunter's lineage-chain narrative was embellished; the update-cadence conclusion stands on the verifier's own binary inspection.
- **Caveats**: RFA-as-statewide-maintainer attribution is plausible but was not independently re-verified (legislative-oversight presentation unreachable). Live-site WAF/timeout means probes need a browser-grade fallback.

#### TX — Texas
- **Portal**: Texas Legislative Council — Capitol Data Portal
- **URL**: https://data.capitol.texas.gov/dataset/vtds
- **Format**: shapefile (.shp in .zip)
- **Cadence**: per-election-cycle — a new VTD vintage per primary/general (2022 and 2024 vintages both present; historical vintages retained)
- **License (CORRECTED — stronger than originally reported)**: the CKAN dataset page has a dedicated License module reading exactly: "Creative Commons Attribution" (linked to opendefinition.org/licenses/cc-by, i.e. **CC-BY**). Per-dataset license field, not a site-wide disclaimer.
- **Post-2022 evidence (independently re-fetched via Wayback snapshot 20260106081212, HTTP 200 — live host Cloudflare-blocks automated fetch)**: resource list confirms `VTDs_24PG.zip` (SHP, "2024 Primary & General Elections VTDs Shapefile"), `VTDs_24PG_Pop.zip`, RED605 population PDF/XLS, plus prior `VTDs_22G.zip` / `VTDs_22P.zip`. Page states "There are 9,712 VTDs in the 2024 primary & general elections VTDs shapefile."
- **Caveats**: Cloudflare 403 on automated fetch (both WebFetch and curl w/ browser UA) — probe design must treat WAF 403 as reachability-unknown, not source-death; the CKAN API endpoint is the better probe target.

#### UT — Utah
- **Portal**: Utah UGRC (Utah Geospatial Resource Center) — VISTA Ballot Areas, State Geographic Information Database (SGID)
- **URL**: https://gis.utah.gov/products/sgid/political/voter-precincts/ (AGOL item d33f596419d74948a45070275632b8e0)
- **Format**: ArcGIS FeatureServer (+ shapefile/FGDB downloads per SGID conventions)
- **Cadence**: rolling/as-needed — county clerks submit updates as annexations and precinct/subprecinct changes occur
- **License (verbatim, agreed by two independent channels — raw item JSON + product page)**: "The data, including but not limited to geographic data, tabular data, and analytical data, are provided \"as is\" and \"as available\", with no guarantees relating to the availability, completeness, or accuracy of data, and without any express or implied warranties. These data are provided as a public service for informational purposes only. You are solely responsible for obtaining the proper evaluation of a location and associated data by a qualified professional. UGRC reserves the right to change, revise, suspend or discontinue published data and services without notice at any time. Neither UGRC nor the State of Utah are responsible for any misuse or misrepresentation of the data. UGRC and the State of Utah are not obligated to provide you with any maintenance or support. The user assumes the entire risk as to the quality and performance of the data. You agree to hold the State of Utah harmless for any claims, liability, costs, and damages relating to your use of the data. You agree that your sole remedy for any dissatisfaction or claims is to discontinue use of the data. This work is licensed under a Creative Commons Attribution 4.0 International License." (**CC-BY-4.0**)
- **Post-2022 evidence (independently re-fetched)**: item modified epoch 1783084331000 = **2026-04-03**; version-history dates corroborated (2026-04-03, 2025-09-16, 2025-04-25, 2025-04-01, 2025-01-15, 2024-12-19, 2024-01-12, plus older). "All 29 counties in Utah" — full statewide coverage.
- **Caveats**: item description's "Current as of 1/31/2022" refers to the political-district redraw, not the precinct layer's maintenance — cite the modified/version-history dates.

#### VT — Vermont
- **Portal**: Vermont Center for Geographic Information (VCGI) + VT Secretary of State — Vermont Open Geodata Portal
- **URL**: https://geodata.vermont.gov/datasets/VCGI::vt-data-vermont-municipal-voting-districts/about (item fae5aad934a74108812dbe8ecd6232d4)
- **Format**: ArcGIS FeatureServer (+ shapefile/GeoJSON/CSV/KML downloads via the portal)
- **Cadence**: irregular — updated when municipalities redraw wards/districts; this vintage tied to the 2022 redistricting cycle, released for Town Meeting Day 2023
- **License (verbatim)**: "VCGI and the State of Vermont make no representations of any kind, including but not limited to the warranties of merchantability or fitness for a particular use, nor are any such warranties to be implied with respect to the data."
- **Post-2022 evidence (independently re-fetched)**: raw item JSON — modified epoch 1687964393000 = 2023-06-28, description verbatim: "Statewide layer of municipal (local) election voting districts (wards) in Vermont. Compiled by VCGI using best available information from Vermont Municipalities and the Vermont Secretary of State. Current as of June 2023."
- **Caveats**: "current as of June 2023" is now ~3 years old — still the most recent state-published vintage, legitimately post-2022-redistricting. 9 named unincorporated gores/grants documentedly excluded (no municipal government). Front-end page didn't render for the verifier; the item JSON (authoritative) matched the hunter character-for-character.

#### WA — Washington
- **Portal**: WA Geospatial Open Data Portal (geo.wa.gov), data from WA Office of the Secretary of State; mirrored as direct ZIPs on sos.wa.gov
- **URL**: https://geo.wa.gov/datasets/wa-geoservices::statewide-precincts/about · service: https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Statewide_Precincts_2019General_SPS/FeatureServer · https://www.sos.wa.gov/elections/data-research/election-data-and-maps/reports-data-and-statistics/precinct-shapefiles
- **Format**: ArcGIS Feature Service (single statewide layer, **8,208 records** confirmed via live query) with csv/shapefile/sqlite/geoPackage/filegdb/geojson/kml/excel exports; plus yearly statewide ZIP (shapefile) downloads back to 2004
- **Cadence**: annual, per general election
- **License (verbatim, exact match to item licenseInfo)**: "Provided as-is. Washington Office of the Secretary of State reserves the right to alter, suspend, re-host, or retire this service at any time and without notice. This service can be used in custom web applications and software products. Your use of this service in these types of tools forms a dependency on the service definition (available fields, layers, etc.) If you form any dependency on this service, be aware of a significant risk to your purposes. Consider mitigating your risk by extracting the source data and using it to host your own service in an environment under your control."
- **Post-2022 evidence (independently re-fetched)**: item f5431071d8f74a7fb655bf0477ccfc2e — snippet "Voting precincts within the State of Washington as defined by the Office of the Secretary of State. December 2025.", modified epoch 1766076860000 = **2025-12-18**. sos.wa.gov page confirms `.../2025-11/Statewide_Precincts_2025General.zip` + `Statewide_Splits_2025General.zip` and the full year sequence.
- **Caveats**: the license itself recommends extracting source data and self-hosting — exactly our ingest model. Note the service path retains a legacy "2019General" name.

#### WI — Wisconsin (archetype)
- **Portal**: Wisconsin Legislature — Legislative Technology Services Bureau (LTSB) GIS Hub
- **URL**: item: https://www.arcgis.com/sharing/rest/content/items/1ed4da2e296e4ae687fd9d35baca57be ("WI Municipal Wards (2026)") · service: https://services1.arcgis.com/FDsAtKBk8Hy4cAH0/arcgis/rest/services/WI_Wards_Jan_2026/FeatureServer · hub: https://gis-ltsb.hub.arcgis.com/pages/download-data
- **Format**: ArcGIS Feature Service (statewide, all counties/municipalities), shapefile/geojson/csv/sqlite/geoPackage/filegdb/kml/excel exports
- **Cadence**: **semiannual, statutorily mandated** — Wis. Stat. 5.15(4)(br)1: county clerks transmit municipality/ward/supervisory-district boundaries to LTSB by January 15 and July 15 each year (census-year exception: March/October 15)
- **License (verbatim, exact match to item licenseInfo)**: "This is open and publicly available data. Use this data at your own risk. The LTSB is not liable for any damages or errors that result in using this data."
- **Post-2022 evidence (independently re-fetched)**: item + service JSON — "Wisconsin Municipal Wards collected in February 2026 through LTSB's GeoData Collector", created epoch 1772136755000 = 2026-02-26, modified 1773074566000 = 2026-03-09. Same org also hosts "WI Municipal Wards (Current)" (modified 2026-03-10) and a "Live Collection" web map modified epoch 1782917761000 = **2026-07-01** — updated within days of verification.
- **Caveats**: none — strongest CONFIRMED in the survey; this is the archetype the lane is built around.

#### DC — District of Columbia
- **Portal**: Open Data DC (DC GIS / DC Office of Planning + DC Board of Elections)
- **URL**: https://opendata.dc.gov/maps/DCGIS::voting-precinct (item 8d512fde2ba34212ad07e9579d55496f) · service: https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/0 · wards: https://opendata.dc.gov/datasets/DCGIS::wards-from-2022/about
- **Format**: ArcGIS FeatureServer/MapServer (live-queried), shapefile ZIP, GeoJSON, KML, CSV, OGC WMS
- **Cadence**: precincts: irregular/event-driven — current layer delineated 2024, reloaded 2026-06-24; wards: decennial only
- **License (verbatim, via live item JSON)**: current Voting Precinct layer: "Creative Commons Attribution 4.0 International License". Wards from 2022: "This work is licensed under a Creative Commons Attribution 4.0 International License." (**CC-BY-4.0**)
- **Post-2022 evidence (independently re-fetched)**: live FeatureServer query returned features with CREATED=1782344505000 / EDITED=1782344816000 = **2026-06-24T23:41–23:46Z** — feature-level data-load evidence, not a metadata touch. Item created/modified 2026-06-30. `returnCountOnly` = **144** precincts covering the full District extent.
- **Caveats**: **this row reverses the original hunter's verdict** — the hunter cited only the frozen "Voting Precinct 2019" layer and concluded DC had no live product because of the Vote Centers law (D.C. Law 24-342). The current "Voting Precinct" item is separate, BOE-attributed, and actively maintained; its own description acknowledges Vote Centers while confirming precincts persist as an administrative/reporting geography. "Statewide" = citywide (single jurisdiction).

---

### 2.2 PLAUSIBLE (4) — follow-up confirms required; BARRED from ingest until confirmed

#### AK — Alaska
- **Portal**: Alaska DCCED/DCRA Community Database Online on the State of Alaska Geoportal (gis.data.alaska.gov), precinct lines from the AK Division of Elections
- **URL**: https://gis.data.alaska.gov/maps/DCCED::precincts/about · service: https://maps.commerce.alaska.gov/server/rest/services/Govt_Related/Govt_House_and_Senate_Districts/MapServer/4
- **What IS independently confirmed**: statewide scope, publisher attribution, and post-2022 modification — geoportal search-API JSON shows createdDate 2023-02-06, modifiedDate **2024-11-12**, description "Part of Alaska Division of Elections Statewide Election Framework. Alaska Precincts based on 2022 Redistricting."; raw MapServer JSON confirms "Alaska election precinct boundaries… Sourced from the Alaska Division of Elections."
- **Why not CONFIRMED**: the license/disclaimer full text and the shapefile-download claim rest solely on the hunter — the Hub about page is JS-only and returned no usable content on two fetch attempts. Layer copyrightText is just an attribution string ("SOA DCCED DCRA, SOA DE"), not a reuse license.
- **To confirm**: human-browser read of the Hub about/download page for license + export options. (elections.alaska.gov remains WAF-blocked.)

#### DE — Delaware
- **Portal**: Delaware FirstMap / Dept. of Elections GIS
- **URL**: https://enterprise.firstmap.delaware.gov/arcgis/rest/services/Boundaries/DE_Political_Boundaries/FeatureServer/0
- **What IS independently confirmed**: the parent FeatureServer's own description states "Election district boundaries were most recently revised in November 2023" — first-party, on-page post-2022 evidence. Statewide scope and state-agency hosting are solid.
- **Why not CONFIRMED**: (1) **no license text exists anywhere found** — only a Copyright credit ("The Delaware General Assembly & Department of Elections"); FirstMap has no terms page (/terms 404s). (2) **Identity question**: Delaware's own elections maps page lists "Election Districts" (RD-ED) and never uses the word "precinct" — RD-ED reads as a legislative-sub-district building block; equivalence to a polling-place precinct/ward unit is unverified and in active tension with the state's own terminology.
- **To confirm**: license determination + a definitional answer (from DE Dept. of Elections) on whether RD-EDs are the precinct-equivalent civic unit.

#### LA — Louisiana
- **Portal**: Louisiana Legislature redistricting site (redist.legis.la.gov)
- **URL**: https://redist.legis.la.gov/default_ShapeFiles2020
- **What IS independently corroborated (search-level only)**: a second independent search pass surfaced "2026 Precinct Shapefile has been updated to reflect precinct changes submitted to the Legislature as of January 27, 2026" (spring cycle, parish submissions under R.S. 18:532/532.1); semiannual spring/fall cadence.
- **Why not CONFIRMED**: *.la.gov is DNS-blocked from the verification environment (SERVFAIL on redist.legis.la.gov, www.legis.la.gov, house.louisiana.gov — resolver-level, not a dead site). Nobody on this pass has personally seen the page; license text unverified (generic Legislature disclaimer known from snippets only).
- **To confirm**: fetch from an unblocked network; capture license text + the dated shapefile listing. Likely the strongest PLAUSIBLE — semiannual cadence would rank it beside WI.

#### MN — Minnesota
- **Portal**: MN Secretary of State (Elections Division) via MN Geospatial Commons (gisdata.mn.gov)
- **URL**: https://gisdata.mn.gov/dataset/bdry-votingdistricts
- **What happened**: both the hunter and the verifier independently hit the Radware bot-management wall across the mn.gov domain family (WebFetch 303-redirected to a generic IT-services page; curl with browser UA returned the "Unusual Activity" interstitial). Nothing — scope, license, vintage — could be personally observed.
- **Why not CONFIRMED**: access barrier, not a debunking. Format/cadence claims are search-snippet-only.
- **To confirm**: human browser session (or unblocked network) against the Geospatial Commons dataset page / CKAN API.

---

### 2.3 NONE (24) — no statewide, openly published, between-census-updated file

For each: what was checked, why NONE, and the re-verification status from the adversarial pass.

- **AL** — SOS election-data page fetched directly via curl: only Voter Registration Statistics PDFs (2002–2026) and precinct-level election RESULTS tables; grep for shapefile/GIS/.shp/geojson/"precinct boundar"/"ward boundar" across the full HTML: zero substantive hits. **NONE upheld, independently spot-checked.**
- **AZ** — No statewide product found at SOS or the Independent Redistricting Commission; irc.az.gov/gis-data returns 403 (consistent with the hunter's blocked access). IRC's statutory mandate is congressional/legislative maps, not precincts. County-by-county (Maricopa, Pima, Pinal) not re-checked — not required to overturn. **NONE upheld.**
- **CO** — Colorado Geospatial Portal / State Demography Office / SOS: no statewide precinct product; the "Voting Districts" layer is decennial Census TIGER pass-through, not CO-authored; county precinct GIS (Douglas, Boulder, Fremont) with no state aggregator. **Not independently re-fetched this pass (no candidate URL existed); internally consistent with CO's county-administered structure — flagged as not independently fetched.**
- **CT** — OPM GIS/DAPA + UConn MAGIC: only decennial 2010 Census VTD on MAGIC; OPM publishes redistricting maps, not precincts; 169 towns each administer their own districts. **Not independently re-fetched (no URL to check); flagged as such.**
- **FL** — dos.fl.gov precinct-level data is election RESULTS (tabular), not boundary GIS; FGDL/geodata.floridagio.gov carry no state-authored precinct layer; 67 county Supervisors of Elections; statute requires notification to the Secretary of State, not GIS delivery. **Not independently re-fetched (GA was this batch's designated spot-check); flagged as such.**
- **GA** — Spot-check attempted on all three primary sources: data-hub.gio.georgia.gov (JS shell, no content), sos.ga.gov/election-data-hub (403), legis.ga.gov reapportionment (JS shell). Inconclusive but nothing surfaced contradicting NONE; statewide boundary compilation exists only via third parties (VEST/RDH/ARC). 159 counties / 3,000+ precincts, county stewardship. **NONE left unchanged.**
- **IL** — **Independently confirmed via curl** (WebFetch was Cloudflare-403'd; direct GET returns the plain IIS directory listing): elections.il.gov/precinctmaps/ = per-county PDF folders. **Correction to the hunter**: post-2022 activity exists (Cook County folder 12/10/2024 with per-township PDF packages dated 12/5/2024; DuPage 7/20/2023) — but it is PDF-only, per-county/per-township, no statewide GIS. elections.il.gov/shape/ carries only legislative/congressional shapefiles, no precinct layer of any vintage. **NONE upheld (grounds corrected).**
- **KS** — hub.kansasgis.org "Voting Districts" (KLRD): substantive content "Current as of 2022"; KLRD does not maintain precincts between censuses (next cycle 2028). Catalog "modified 2026-05-06" is a re-index, not a data update. **Re-check inconclusive this pass (Hub page is a JS shell; needs REST JSON fetch) — verdict stands on the fails-the-between-census-test finding.**
- **KY** — **Independently re-confirmed**: LRC GIS-Data page returns 403 (matches hunter); opengisdata.ky.gov JS-rendered; independent search surfaces only county-level sources (Jefferson/LOJIC, Lexington). **NONE confirmed.**
- **ME** — **Independently re-verified via the ArcGIS sharing REST JSON** (item e9304363e34e4425b784360f14d435e5): "Maine Voting Districts" is 2021 legislative/congressional/county-commissioner redistricting seats + town boundaries + census blocks — wrong data type, not precincts/wards. License field verbatim re-verified: "Access: Public. Use: User assumes risk." Minor correction: modified 2025-03-27 (hunter said 2024) — verdict unaffected. Ward/precinct administration is town-clerk-level with no state standardization. **NONE confirmed.**
- **MS** — **Independently fetched** maris.mississippi.edu UpdatedVotingPrecincts page: exactly 13 of 82 counties, files `<COUNTY>_Precincts_2023.zip`, "Current Data: 2023", sourced from "Golden Triangle PDD and other individual counties"; no statewide file mentioned. sos.ms.gov 403-blocked (referral-text sub-claim unverified; immaterial). **NONE confirmed.**
- **MO** — **Independently verified twice**: sos.mo.gov/elections/maps offers only State Senate + State House PDF maps (WebFetch succeeded before a later curl hit the WAF); msdis.missouri.edu mapdata index fetched (200), grepped for precinct/voting district: zero matches. County/city layers (St. Louis City/County, Jackson) per hunter, not re-verified. **NONE confirmed.**
- **NE** — sos.nebraska.gov / nebraskamap.gov DNS-failed from the tool; corroborated via search: SOS hosts 2020-census redistricting maps (congressional/legislative), not precincts. Independent third-party confirmation: MGGG's NE-shapefiles repo had to hand-stitch precincts from NebraskaMAP + county officials, and even that is 2018-vintage. Counties (Cass, Lancaster, Sarpy) publish independently. **NONE stands, third-party-corroborated.**
- **NV** — SOS county-precinct-maps page is the statutory collection point (NRS 293.206, biennial March-31 even-year submissions) but republishes a per-county PDF index, no merged statewide GIS. Direct fetch 403; curl returned a live Imperva/Incapsula interstitial (read in raw HTML). Snippets vaguely reference an "interactive GIS-based map" that could not be substantiated as a downloadable statewide dataset — flagged unresolved, not contradicting. **NONE kept (confidence downgraded by the access wall, not the finding).**
- **NJ** — **Independently re-confirmed from primary-source JSON**: NJOGIS statewide "Election Districts" + "Ward Boundaries" items are both "MATURE SUPPORT… no longer updated. Available for historical reference only" (2018–2023 Election Security Initiative products); Dec-2024 modified timestamps are metadata touches. ArcGIS API search restricted to owner:NJOGIS returns exactly these two frozen items, no successor ("Voting Districts - 2024" search hit was a listing artifact). Current data is county/municipal only. Full licenseInfo captured (as-is/no-warranty/no-duty-to-update). **NONE fully reconfirmed.**
- **OH** — No state product; precinct-setting is a county statutory duty (ORC 3501.05). ohiosos.gov Cloudflare-403s automated fetch (consistent with bot protection, not fabrication). **Independently verified via GitHub API**: mggg/ohio-precincts — "Shapefile of voting precincts in Ohio (as of 2016)", pushed_at 2019-11-14 — the only statewide stitch-together is stale academic work. **NONE corroborated.**
- **OK** — **Independently fetched the live okmaps.org item (200 OK)**: metadata Date = 2022-01-01, "2020 Voter Precincts", statewide merged from all 77 counties; license lines verified verbatim ("This data is for general public use." / "Data is free. Some fees may apply to offline requests to cover reproduction costs."). Genuinely statewide and free — **fails the post-2022-update test**; no re-issuance found. **NONE confirmed.**
- **OR** — **Independently reproduced exactly**: data.oregon.gov r7vb-b9k4 JSON API returns only county/precinct/split/district_code fields — zero geometry; a pure precinct-to-district crosswalk table. **NONE confirmed.**
- **PA** — Live redistricting.state.pa.us refused connections (matches hunter). **Verified via Wayback CDX**: fetched the most recent snapshot (2026-04-11) — still the static one-time 2021 Census-VTD-correction shapefile product; no 2022+ release in any snapshot through April 2026. Checked 8+ months past the hunter's window; unchanged. **NONE confirmed and strengthened.**
- **SD** — **Independently re-queried the AGOL REST search API**: all SD precinct items are county/city-owned (Sioux Falls, Fall River, Natrona-style county accounts) or off-topic; no state-agency item. SOS elections path tried returned 404 (no GIS download page). **NONE confirmed.**
- **TN** — **Independently fetched the live Comptroller page**: four per-county product categories only (Land Use, County District Maps, Parcel Data, County Indices); no statewide precinct file; custom-data contact only. **NONE re-verified.**
- **VA** — **Independently re-verified by direct fetch**: elections.virginia.gov GIS page = per-locality ZIPs only, all 134 counties/independent cities listed separately; "as current as possible" rolling per-locality language; no combined statewide file. Cross-checked VGIN (200 OK) + AGOL search + data.virginia.gov CKAN: no statewide VA precinct item from any state authority. **NONE upheld.**
- **WV** — **Independently re-ran AGOL search**: 21 results, all county-specific (Jefferson, Marion) or generic redistricting-review layers; nothing owned by WVGISTC/mapwv/SOS statewide. **NONE upheld.**
- **WY** — **Independently re-ran AGOL search**: 3 results, all county-owned (Sheridan, Carbon, Natrona); no SOS or Geospatial-Hub statewide layer; state directs users to counties / voter lookup tool. **NONE upheld.**

### 2.4 UNSWEPT (0)

None. All 51 jurisdictions were swept and dispositioned above. (Agent-loss count from the hunt: 0.)

---

## 3. Proposed overlay ingest wave — CONFIRMED rows only

Ranked by 2020 Census resident population covered. **PLAUSIBLE rows (AK, DE, LA, MN)
are explicitly barred from this list** — they are follow-up confirms (see §2.2); if all
four confirm they would add ≈12.1M people (~3.6%).

License gate legend — **clear**: explicit open/attribution license or "no
restrictions" text observed; **review**: no license text observed (or not
page-verified) → human license review before *signed republication* (attribution-only
serving may still be fine; counsel call, per the same rule as county terms in §5).

| # | State | 2020 pop | Source | License gate | Notes |
|---|---|---:|---|---|---|
| 1 | CA | 39,538,223 | UC Berkeley SWDB | **review** | No reuse license beyond UC Regents copyright — get rights confirmation from SWDB first. Largest single prize in the lane. |
| 2 | TX | 29,145,505 | TX Legislative Council | clear (CC-BY) | WAF blocks automated fetch — ingest via CKAN API/mirror path. |
| 3 | NY | 20,201,249 | NYS ITS / BOE | clear (as-is disclaimer, no use restriction) | Rolling; includes NYC. |
| 4 | NC | 10,439,388 | NCSBE S3 bucket | **review** (terms page is JS-only) | Cheapest change detection (S3 listing). |
| 5 | MI | 10,077,331 | MI BOE / DTMB | clear ("no restrictions on the use, reproduction, or distribution") | Ingest newest active cycle item, not a pinned year. |
| 6 | WA | 7,705,281 | WA SOS | clear (as-is; explicitly invites self-hosting) | Annual vintages + Dec-2025 service. |
| 7 | MA | 7,029,917 | MassGIS | clear ("may be used by anyone"; credit required) | 2022 plans + 2024 corrections. |
| 8 | IN | 6,785,528 | IN GIO | clear (as-is disclaimer) | Annual series; 5,126 districts. |
| 9 | MD | 6,177,224 | MD iMap / SBOE | **review** (disclaimer corroborated, not page-verified) | Howard Co. lags at 2022 — per-county vintage in provenance. |
| 10 | WI | 5,893,718 | WI LTSB | clear ("open and publicly available") | Archetype; statutory semiannual. |
| 11 | SC | 5,118,425 | SC RFA | **review** (no license text on page) | WAF/timeouts — needs resilient fetch path. |
| 12 | UT | 3,271,616 | UGRC | clear (CC-BY-4.0) | Rolling, well-versioned. |
| 13 | IA | 3,190,369 | IA SOS / LSA | **review** (licenseInfo null) | Decennial-plus-corrections — provenance must not imply annual currency. |
| 14 | AR | 3,011,524 | AR GIS Office | clear ("no access and use limitations") | Highest churn — rolling county updates. |
| 15 | NM | 2,117,522 | NM SOS / UNM EDAC | clear (free download; no access constraints) | New vintages = new UUIDs; watch the SOS page. |
| 16 | ID | 1,839,106 | ID SOS / ITS | clear (as-is disclaimer; public_authoritative) | Courtesy-confirm the "DO_NOT_SHARE" service name. |
| 17 | HI | 1,455,271 | HI Statewide GIS / OOE | clear (public domain per GIS program page) | 250 precincts; per-cycle layers. |
| 18 | NH | 1,377,529 | NH GRANIT | clear (access/use constraints: None) | Effectively per-redistricting cadence. |
| 19 | RI | 1,097,379 | RIGIS | clear (as-is; acknowledge RIGIS + producers) | 2022 base + real ad-hoc edits. |
| 20 | MT | 1,084,225 | MT State Library | clear (access: none; informational-use disclaimer) | FGDB+shp on FTP; May-2026 publication. |
| 21 | ND | 779,094 | ND SOS | **review** (no license text) | Per-cycle ZIP (FGDB). |
| 22 | DC | 689,545 | Open Data DC | clear (CC-BY-4.0) | 144 precincts; June-2026 reload. |
| 23 | VT | 643,077 | VCGI / SOS | clear (no-warranty disclaimer, no use restriction) | June-2023 vintage — oldest CONFIRMED; provenance must say so. |

**Total: 168,668,046 people (50.9% of the 2020 resident population of 331,449,281).**

Suggested tranching within the wave: start with the **clear-license, machine-friendly
REST/S3 sources** (TX via API path, NY, MI, WA, MA, IN, WI, UT, AR, HI, RI, MT, DC —
then NM, ID, NH, VT, ND after its license check), run the **license-review five** (CA,
NC, MD, SC, IA + ND) in parallel as a legal/ops task, and land CA the moment SWDB
confirms rights — it alone is 23% of the lane's population.

---

## 4. Source-registry rows (P14 `SOURCE_REGISTRY` additions)

One row per CONFIRMED source, following `SourceHealthConfig` in
`SELF-HEALING-DATA-OPS.md` §Source registry. Common fields for all rows:
`class: 'boundary-geometry'`, `retryBudget: 6`, `ownerSlots: '21'` (precinct/VTD
overlay slot; the overlay never owns the baseline slots). `configSite` is assigned when
the overlay ingest config lands (P17-style wave). **Rows enter `SOURCE_REGISTRY` with
their ingest tranche** — registering un-ingested sources would page on data we don't
serve yet.

`expectedIntervalDays` is derived from the REAL observed cadence (§2.1), with slack so
the staleness breach fires on genuine silence, not on normal jitter. No cadence below
is invented; where a source is decennial-plus-corrections, the interval says so
honestly rather than pretending currency.

| id | probe/fetch target | expectedIntervalDays | freshness | lane | probe method | cadence basis |
|---|---|---:|---|---|---|---|
| `precinct-ar` | AR FeatureServer/11 (checksum) | 90 | rolling | **fetch** | — | county updates land ~monthly; silence past a quarter is anomalous |
| `precinct-ca` | statewidedatabase.org/election.html | 400 | vintage | probe | conditional-get | ≥1 statewide release/election year |
| `precinct-hi` | geodata.hawaii.gov AdminBnd/MapServer/13 `?f=pjson` | 780 | vintage | probe | get | biennial (per general election) |
| `precinct-id` | AGOL item 0b4fbe4f…21705 `?f=json` | 780 | vintage | probe | get | biennial, statutory even-year updates |
| `precinct-in` | gisdata.in.gov Voting_District_Boundaries_{yyyy} service root | 400 | vintage | probe | get + nextVintage template `Voting_District_Boundaries_{yyyy}` | annual series (2020/2023/2024… editions) |
| `precinct-ia` | AGOL item d394edea…532f `?f=json` | 3650 | vintage | probe | get | decennial reprecincting + opportunistic corrections — honest interval, probe still daily |
| `precinct-md` | MD_ElectionBoundaries FeatureServer/2 `?f=pjson` | 400 | rolling | probe | get | annual-ish SBOE re-collection (2025 collection → 2026-01 publish) |
| `precinct-ma` | AGOL item 6d4ae7ef…2e64 `?f=json` (or DCAT record) | 730 | rolling | probe | get | irregular LEDRC-event-driven; last real change 2024-02 |
| `precinct-mi` | AGOL search API `owner:michigan_admin title:"Voting Precincts"` | 780 | vintage | probe | get (search JSON; picks up new cycle items) | per-even-year cycle |
| `precinct-mt` | ftpgeoinfo.msl.mt.gov MontanaVotingPrecincts.zip | 730 | rolling | probe | head (Last-Modified is meaningful) | as-needed; 2023 redistricting + 2026-05 publication |
| `precinct-nh` | ftp.granit.unh.edu d-nhpolitdists/ parent listing | 3650 | vintage | probe | get (listing; new vintage = new subfolder) | as-needed, per-redistricting in practice |
| `precinct-nm` | sos.nm.gov gis-voting-district-data page | 730 | rolling | probe | conditional-get (new vintages get new UUIDs — watch the SOS page, not the UUID) | as-needed, county-triggered; last vintage 2024-07 |
| `precinct-ny` | AGOL item 23a05670…5998 `?f=json` | 365 | rolling | probe | get | rolling; modified 2026-06 |
| `precinct-nc` | S3 `list-type=2&prefix=ShapeFiles/Precinct/` (checksum of listing) | 180 | rolling | **fetch** | — | 2–4 releases/year observed 2022→2026 |
| `precinct-nd` | sos.nd.gov voting-shape-files-{yyyy}.zip | 780 | vintage | probe | head + nextVintage template `voting-shape-files-{yyyy}.zip`, windowMonths [1–4 of even years] | per-election-cycle |
| `precinct-ri` | AGOL item 9104ca2e…514d `?f=json` (+ layer editingInfo) | 730 | vintage | probe | get | 2022 base + ad-hoc edits (2024-09, 2025-01) |
| `precinct-sc` | rfa.sc.gov political-gis-data page | 400 | rolling | probe | get (WAF risk: treat 403/timeout as reachability-unknown → escalate to browser-grade fallback, not fetch-breach) | burst edits under a running Effective date, ~annual re-issuance |
| `precinct-tx` | data.capitol.texas.gov CKAN `package_show?id=vtds` | 780 | vintage | probe | get (CKAN API, NOT the Cloudflare-fronted HTML) | per-election-cycle (22P/22G/24PG…) |
| `precinct-ut` | AGOL item d33f5964…b8e0 `?f=json` (checksum on modified) | 180 | rolling | **fetch** | — | 2–4 versioned updates/year, unannounced |
| `precinct-vt` | AGOL item fae5aad9…32d4 `?f=json` | 3650 | vintage | probe | get | municipal-redraw-driven; last real change 2023-06 — interval reflects reality |
| `precinct-wa` | AGOL item f5431071…fc2e `?f=json` | 400 | vintage | probe | get + nextVintage on sos.wa.gov `Statewide_Precincts_{yyyy}General.zip`, windowMonths [11,12,1] | annual per general election |
| `precinct-wi` | AGOL item 1ed4da2e…57be `?f=json` | 230 | vintage | probe | get + nextVintage via LTSB hub new-cycle items, windowMonths [2,3,8,9] (post Jan-15/Jul-15 statutory deadlines) | statutory semiannual |
| `precinct-dc` | AGOL item 8d512fde…496f `?f=json` | 730 | rolling | probe | get | event-driven; 2024 delineation, 2026-06 reload |

Lane rationale: `fetch` (daily change-check with checksum semantics) is reserved for
the three rolling sources whose updates are frequent, unannounced, and cheap to
checksum (AR FeatureServer, NC S3 listing, UT item JSON). Everything else is `probe`
(daily reachability + window-gated next-vintage checks) — per the lane-exclusivity
invariant, exactly one lane owns each source's clock. WAF-fronted sources (TX, SC)
carry probe configs that distinguish bot-wall 403s from real outages so we don't burn
retryBudget on Cloudflare/Imperva interstitials.

---

## 5. What full national currency would take — the ~3,033-county problem

The 23 state overlays take served-precinct currency from 0% to ~51% of population for
roughly $0 in recurring cost. The remaining ~49% lives in NONE states where precinct
boundaries are maintained by ~county-level authorities (the US has ~3,033 organized
county governments; NONE-state counties are the relevant subset). Three tiers, in
strictly increasing cost:

**Tier 1 — state overlays (this lane, ≈$0).**
The 23 CONFIRMED sources above, plus the 4 PLAUSIBLE follow-ups (AK, DE, LA, MN —
≈12.1M more people if all confirm; LA's semiannual statutory cadence would make it a
top-tier source). Cost is one-time ingest engineering plus the existing self-healing
probe/change-check machinery. No new infra, no vendors, no addresses leaving our
control.

**Tier 2 — county open-GIS discovery sweep (agentic, measurable, ≈$0 marginal).**
Many NONE-state counties already publish open precinct GIS: Maricopa/Pima (AZ), Cook/
DuPage/Lake/Will (IL), Douglas/Boulder/Fremont (CO), Fulton + ARC (GA), Jefferson/
Lexington (KY), St. Louis City/County + Jackson (MO), Cass/Lancaster/Sarpy (NE),
Jefferson/Marion (WV), Sheridan/Carbon/Natrona (WY), and so on — every one surfaced
during this survey without even looking hard. The same agentic hunt that produced this
document enumerates county GIS portals per NONE state, applies the same
CONFIRMED/PLAUSIBLE/NONE bar per county, and feeds CONFIRMED counties into the same
registry/probe/ingest machinery with `id: precinct-{st}-{countyfips}`. Coverage becomes
a measurable number (population-weighted % per state), and the self-healing lane keeps
it honest. The deliverable is partial-state overlays with county-level provenance —
served districts in covered counties get currency; the rest stay on the 2020 baseline,
labeled as such. No overstatement: a state is never marked "current" because three of
its counties are.

**Tier 3 — records-request / digitization long tail (paid data-ops, customer-gated).**
The counties with no open GIS — PDF maps (IL townships, NV per-county index, TN
KMZ/PDF), paper filings, or nothing online — require a standing data-ops program:
records requests, digitization, county-clerk relationships, per-county refresh
tracking. This is exactly the VEST/RDH cost structure, and it is why no vendor sells a
current national file. Per the bootstrapping cost posture, this tier incurs **no
spend until a paying customer of this capability closes**, and then only for the
geographies that customer needs (proofWeight saturates sublinearly — saturating
contained geographies beats thin national coverage anyway). **License review is
per-county and non-optional here**: county terms are not uniformly open, and non-open
terms may bar signed republication of derived boundaries — same gate as the
license-review rows in §3, applied at county grain.

The three tiers are strictly ordered by cost and strictly decreasing in
population-per-dollar. Tier 1 is this lane. Tier 2 is a repeat of this hunt one level
down, on machinery that already exists. Tier 3 is a business decision that a customer
signs, not an engineering default.
