# Dagupan flood reports (validation ground truth)

`dagupan_flood_reports.csv`: barangay-level flood mentions in news and city reports, 2023 to 2026, for checking LAMBAT's barangay flood exposure ranking. One row per barangay per event. 65 rows, 13 events, 26 of the 31 barangays appear at least once. `barangay` uses the exact LAMBAT names; the spelling as reported is in `note`. `opened` is "yes" for every row (all pages were opened and read; see caveats for what was not).

Compiled 2026-10-23 by web search plus opening each page. Sources: GMA Regional TV and GMA News (most rows), Punch Dagupan, Bombo Radyo Dagupan.

## Caveats

- Reports are not a census. News names the central/coastal barangays (Poblacion Oeste, Barangay I, Pantal) and the Pantal-Sinocalan river barangays (Malued, Lasip, Bacayao, Pogo, Mayombo, Herrero) far more than others. Absence from the file does not mean dry.
- Most articles say a count ("nearly 30 barangays", "25 of 31", "all barangays") without naming them. Those unnamed barangays are not in the file. Egay 2023 (24+2 rows) and Aug 2026 (14 rows) are the best-covered events.
- Aug 2026 rows mostly come from evacuation lists, not flood reports (noted per row). Depth text is sparse and mostly Filipino phrases; real measured flood depths were almost never given.
- Barangay 1 / 2 / 3 / IV naming is inconsistent across sources. "Barangay 1" and "Barangay Uno" were mapped to Barangay I (T. Bugallon), "Barangay 2" to II (Nueva), "Barangay IV" to IV (Zamora). "Barangay 3" and "Barangay 2-3" were left out because no matching name exists in our data. "Lubo" (GMA, 24 Jul 2025, forced evacuation) is not a name in our data and was left out.
- Streets and sitios were mapped only when the source named the barangay (Burgos St and Sitio Baybay/Payar; the source gave Poblacion Oeste or Pantal). Macario St, Tapuac Road, Calle Dos were not mapped.
- Not opened or unreachable (fetch blocked or DNS failure): dagupan.gov.ph (state of calamity page, Jul 2025), Inquirer, PNA, Manila Bulletin, Manila Times. Facts from those are not in the CSV. Search-engine summaries were not used as evidence unless the page was then opened.
- Not found: Typhoon Kristine (Oct 2024), Sept 2024 high tide, and Uwan (Nov 2025) had no barangay names in what was opened. Nothing from DSWD DROMIC or PAGASA was retrieved. The city Facebook page was not searched.
- Never named in any opened report: Bolosan, Carael, Mangin, Salisay, Tebeng (Tebeng appears only in a leptospirosis item below).
- Events before 2018 (e.g. 2015 Pantal River flood, 2012 leptospirosis) are in search results but not in the CSV.

## Leptospirosis by barangay

Almost nothing is published by barangay.

- Aug 2023: City Health Office reported 3 cases since July 2023; the two deaths were one in Tebeng and one in Bonuan Boquig; the third case's location was not given. Punch Dagupan, "Dagupan CHO warns public vs leptospirosis, 'alipunga'", 6 Aug 2023, https://punch.dagupan.com/news/inside-news/2023/08/dagupan-cho-warns-public-vs-leptospirosis-alipunga/ (opened).
- Jun 2019: 1 death, 2 cases Jan to Jun, no barangays named. PTV News (PNA reprint), https://ptvnews.ph/dagupan-health-officials-warn-public-vs-lepto-gastro/ (opened).
- Oct 2025: in Poblacion Oeste (Sitio Payar) "no leptospirosis cases" were recorded; barangay health workers give preventive medicine house to house (drug not named). GMA Regional TV, 9 Oct 2025, https://www.gmanetwork.com/regionaltv/news/110688/health-concerns-raised-due-to-dark-foul-smelling-flood-in-dagupan/story/ (opened).
- 2012 (pre-window): search result snippets say deaths in Mayombo, Poblacion Oeste and Pantal and doxycycline distribution by barangay nurses (Inquirer 256324, 256520). Not opened (Inquirer blocked), so unverified.
- No Dagupan doxycycline distribution site list was found. The 2023 article above says the CHO gives free preventive medicine to people with leg or foot wounds.

## Health facilities

No complete current list is published that was found.

- 12 barangay health stations (Punch Dagupan, 26 Dec 2015, opened, https://punch.dagupan.com/news/2015/12/12-barangay-health-stations-equipped-for-basic-medical-services/): Carael, Pantal, Poblacion Oeste, Bonuan Boquig, Bonuan Binloc, Bonuan Gueset, Bolosan, Salapingao, Malued, Mangin, Mayombo, Pogo Grande. Ten years old.
- Search snippets only (not opened, unverified): main City Health Office in Herrero-Perez with a satellite office in Bonuan Gueset (Punch Dagupan 2021, https://punch.dagupan.com/?p=594666); a two-storey health center in Pantal and the Bonuan Gueset satellite groundbreaking in 2018 (https://punch.dagupan.com/news/2018/07/dagupan-groundbreaks-4-more-infrastructure-projects/); planned Super Family Health Center in Bolosan (https://dagupan.gov.ph/?p=2726). PhilHealth accreditation lists (philhealth.gov.ph FP_043023.pdf, FP_053125.pdf) may list facility addresses; not checked.
- Verify against the City Health Office or DOH facility registry before using for access modelling.
