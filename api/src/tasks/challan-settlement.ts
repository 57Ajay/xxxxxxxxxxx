import type { Task } from "./types";

export const challanSettlement: Task = {
    id: "challan-settlement",
    name: "Challan Settlement Automation",
    requiredParams: ["vehicleNumber"],
    optionalParams: ["mobileNumber", "chassisLastFour", "engineLastFour"],
    tools: [
        {
            name: "save_challans",
            description:
                "Save extracted challans to the database. Call this after extracting ALL challans from Delhi Traffic Police. " +
                "Pass a JSON array of challan objects as the data parameter.",
            parameters: {
                data: {
                    type: "array",
                    description:
                        'Array of objects, each with: challanId (string), offence (string), amount (number in Rs), date (string YYYY-MM-DD). ' +
                        'Example: [{"challanId":"DL123456","offence":"Red Light Violation","amount":500,"date":"2024-06-15"}]',
                },
            },
            endpoint: "/api/internal/challans/save",
            method: "POST",
        },
        {
            name: "save_discounts",
            description:
                "Save discount/settlement amounts from Virtual Courts. Call this after extracting ALL discount data from ALL departments. " +
                "Pass a JSON array of discount objects as the data parameter.",
            parameters: {
                data: {
                    type: "array",
                    description:
                        'Array of discount objects, each with: challanId (string), discountAmount (number in Rs), originalAmount (number in Rs). ' +
                        'Example: [{"challanId":"DL123456","discountAmount":250,"originalAmount":500}]',
                },
            },
            endpoint: "/api/internal/discounts/save",
            method: "POST",
        },
    ],
    buildPrompt: (p) => {
        const hasMobileChange =
            p.mobileNumber && p.chassisLastFour && p.engineLastFour;

        const mobileChangeBlock = hasMobileChange
            ? `
===
PHASE 0 — CHANGE MOBILE NUMBER
===
After you type the vehicle number and click "Search Details", an OTP dialog appears.
Do NOT enter OTP yet. Follow these steps in order:

1. Click "Change mobile Number" link inside the OTP dialog.
2. Fill the "Change Mobile Number" form:
   - "New Mobile Number" → ${p.mobileNumber}
   - "Confirm Mobile Number" → ${p.mobileNumber}
   - "Last Four digit of Chasis Number" → ${p.chassisLastFour}
   - "Last Four digit of Engine Number" → ${p.engineLastFour}
3. Click the green "Submit" button.
4. A new OTP is now sent to ${p.mobileNumber}.
5. Call wait_for_human with reason: "OTP sent to ${p.mobileNumber}. Please enter it in the browser and click submit, then reply done."
6. After human responds, the challan results should now be visible. Continue to PHASE 1 extraction.

Note: If the old OTP dialog reappears after mobile change, a fresh OTP was sent to ${p.mobileNumber}. Enter that OTP and submit.
`
            : "";

        const otpBlock = hasMobileChange
            ? `When the site asks for OTP:
- If you have NOT yet changed the mobile number → follow PHASE 0 first.
- If you ALREADY changed the mobile number → call wait_for_human with reason: "OTP sent to ${p.mobileNumber}. Please enter it and click submit, then reply done."
- After human responds, continue extracting results.`
            : `When the site asks for OTP:
- Call wait_for_human with reason: "OTP required on Delhi Traffic Police. Please enter the OTP, click submit, then reply done."
- After human responds, continue extracting results.`;

        return `
You are automating challan extraction for vehicle ${p.vehicleNumber} across 2 websites.
${hasMobileChange ? `Target mobile for OTP: ${p.mobileNumber}` : ""}

===
YOUR TOOLS
===
- wait_for_human → Call when you need human help (OTP, CAPTCHA). It pauses and returns the human's response. After it returns, CONTINUE the workflow.
- save_challans → Call once after extracting ALL challans from Delhi Traffic Police.
- save_discounts → Call once at the very end after extracting discount records from ALL Virtual Court departments.

===
RULES
===
1. Do NOT call "done" until ALL phases are complete.
2. Use separate tabs for each website. Never close a tab mid-workflow.
3. Read data visually from the screen. Never use JavaScript evaluate() to scrape.
4. Scroll through ALL results on every page. Check for pagination.
5. Track progress in memory: count records extracted vs total that exist.
${mobileChangeBlock}
===
PHASE 1 — DELHI TRAFFIC POLICE (extract challans)
===
1. Open a new tab → https://traffic.delhipolice.gov.in/notice/pay-notice/
2. Type "${p.vehicleNumber}" in the "Vehicle Number" field.
3. Click "Search Details".

${otpBlock}

4. Once results are visible, extract EVERY challan row:
   - Challan ID (full number, e.g. "DL19016240430095546" or "57693177")
   - Offence description
   - Fine amount (number in Rs)
   - Date (YYYY-MM-DD)
5. Scroll down to check for more rows or pagination. Do NOT stop until every row is captured.
6. Skip any row where amount is 0 or missing.
7. If zero challans exist, note "0 challans found" and skip Phase 2 entirely — go to COMPLETION.

8. Call save_challans with ALL extracted data as a JSON array.
   Example: [{"challanId":"DL19016240430095546","offence":"Red Light Violation","amount":500,"date":"2024-06-15"}]

===
PHASE 1.5 — DETERMINE VIRTUAL COURT DEPARTMENTS TO QUERY
===
Look at the challan IDs you just extracted and figure out which Virtual Court departments you need to visit.

HOW TO READ A CHALLAN ID:
- If it starts with 2 LETTERS (e.g. "DL...", "HR...", "UP...") → those 2 letters are the state code.
- If it starts with a DIGIT or has no letter prefix (e.g. "57693177") → it belongs to Delhi(Notice Department).

MAP each state code to a Virtual Courts department name using this table:

  DL → Delhi(Traffic Department)
  (plain digits, no letters) → Delhi(Notice Department)
  HR → Haryana(Traffic Department)
  UP → Uttar Pradesh(Traffic Department)
  CH → Chandigarh(Traffic Department)
  RJ → Rajasthan(Traffic Department)
  PB → Punjab(Traffic Department)
  MP → Madhya Pradesh(Traffic Department)
  MH → Maharashtra(Transport Department)
  GJ → Gujarat(Traffic Department)
  KA → Karnataka(Traffic Department)
  HP → Himachal Pradesh(Traffic Department)
  UK → Uttarakhand(Traffic Department)
  CG → Chhattisgarh(Traffic Department)
  JK → Jammu and Kashmir(Jammu Traffic Department)
  AS → Assam(Traffic Department)
  KL → Kerala(Police Department)
  TN → Tamil Nadu(Traffic Department)
  AP → Andhra Pradesh(Traffic Department)
  TS/TG → Telangana(Traffic Department)
  BR → Bihar(Traffic Department)
  JH → Jharkhand(Traffic Department)
  OD → Odisha(Traffic Department)
  WB → West Bengal(Traffic Department)
  GA → Goa(Traffic Department)
  Any other code → find the matching state in the Virtual Courts dropdown.

Now build a list of UNIQUE departments. Remove duplicates.
Write this in memory:
  "Departments to query: [Delhi(Traffic Department), Haryana(Traffic Department), Delhi(Notice Department), ...]"
  "Departments completed: []"
  "All discount records collected so far: []"

===
PHASE 2 — VIRTUAL COURTS (extract discounts — repeat for EACH department)
===
You will repeat STEP A → STEP C for EACH department in your list, one at a time.
After finishing one department, navigate back to the homepage and do the next.

STEP A — Select department:
1. Go to https://vcourts.gov.in/virtualcourt/index.php (use the same Virtual Courts tab, or open one if this is the first department).
2. In the "Select Department" dropdown, select the current department from your list.
3. Click "Proceed Now".

STEP B — Search:
1. On the next page, click the tab button labeled "Challan/Vehicle No."
2. Type "${p.vehicleNumber}" in the "Vehicle Number" field.
3. Read the CAPTCHA image and type the answer in "Enter Captcha".
4. Click "Submit".
5. If CAPTCHA fails, re-read and retry (up to 5 attempts).
6. After 5 failures, call wait_for_human: "CAPTCHA on Virtual Courts (department: [current department name]) needs solving. Please solve it, click submit, then reply done."

STEP C — Extract results:

FIRST: Scroll down and check if results are already visible. If you see "No. of Records" with a number >= 1 and a data table, the data is already loaded — do NOT re-submit. Go straight to reading the table.

The table has columns: Sr.No., Offence Details, View.

For EACH row (track: "row X of N for [department name]"):
1. Click "View" to expand the record.
2. Read "Challan No." → this is your challanId.
3. In the expanded section, read the "Fine" column → this is originalAmount.
4. Below it, read "Proposed Fine" → this is discountAmount.
5. Include every record, even if Fine equals Proposed Fine.

Scroll through the entire page to confirm all rows are captured.
If "No. of Records :- 0", note "0 records for [department name]".

Add all records from this department to your collected list in memory.
Mark this department as completed.

STEP D — Next department or save:
If more departments remain → navigate to https://vcourts.gov.in/virtualcourt/index.php and repeat from STEP A with the next department.
If ALL departments are done → call save_discounts ONCE with ALL records collected across all departments as a single JSON array.
Example: [{"challanId":"DL19016240430095546","discountAmount":300,"originalAmount":500},{"challanId":"57693177","discountAmount":150,"originalAmount":300}]

===
COMPLETION
===
Only NOW call the "done" action. Report a summary:
${hasMobileChange ? "- Mobile number change: success or failure" : ""}
- Challans found on Delhi Traffic Police: [count]
- Challans saved via save_challans: [count]
- Departments queried on Virtual Courts: [list department names]
- Records found per department: [department: count, ...]
- Total discount records saved via save_discounts: [count]
`.trim();
    },
};
