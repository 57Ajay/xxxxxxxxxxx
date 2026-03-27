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
                    type: "string",
                    description:
                        'JSON array of objects, each with: challanId (string), offence (string), amount (number in Rs), date (string YYYY-MM-DD). ' +
                        'Example: [{"challanId":"DL123456","offence":"Red Light Violation","amount":500,"date":"2024-06-15"}]',
                },
            },
            endpoint: "/api/internal/challans/save",
            method: "POST",
        },
        {
            name: "save_discounts",
            description:
                "Save discount/settlement amounts from Virtual Courts. Call this after extracting ALL discount data. " +
                "Pass a JSON array of discount objects as the data parameter.",
            parameters: {
                data: {
                    type: "string",
                    description:
                        'JSON array of objects, each with: challanId (string), discountAmount (number in Rs), originalAmount (number in Rs). ' +
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
========================================
PHASE 0: CHANGE MOBILE NUMBER (before OTP)
========================================
After you enter the vehicle number and click "Search Details", an OTP dialog will appear.
DO NOT enter the OTP yet. Instead:

1. Click the "Change mobile Number" link inside the OTP dialog.
2. A "Change Mobile Number" form will appear with these fields:
   - "New Mobile Number" → type: ${p.mobileNumber}
   - "Confirm Mobile Number" → type: ${p.mobileNumber}
   - "Last Four digit of Chasis Number" (next to the partial chassis shown) → type: ${p.chassisLastFour}
   - "Last Four digit of Engine Number" (next to the partial engine shown) → type: ${p.engineLastFour}
3. Click the "Submit" button (green button) on this form.
4. A NEW OTP will now be sent to ${p.mobileNumber}.
5. Call wait_for_human with reason:
   "OTP required — sent to NEW mobile number ${p.mobileNumber}. Please enter the OTP in the browser and click submit, then send 'done'."
6. After the human responds, the mobile number is now changed. Continue to Phase 1 results extraction.

IMPORTANT: After the mobile number change + OTP submission, the site should show the challan results.
If it shows the original OTP dialog again (for the old number), the mobile change was successful —
a new OTP has been sent to ${p.mobileNumber}. Enter that OTP and submit.
`
            : "";

        const otpInstructions = hasMobileChange
            ? `If the site asks for a mobile number or OTP and you have NOT yet changed the mobile number:
- Follow PHASE 0 above to change the mobile number first.
If you have ALREADY changed the mobile number and an OTP dialog appears:
- Call wait_for_human with reason "OTP required on Delhi Traffic Police — sent to ${p.mobileNumber}. Please enter the OTP in the browser and click submit, then send 'done'."
- After the human responds, continue from the results page.`
            : `If the site asks for a mobile number or OTP:
- Call wait_for_human with reason "OTP required on Delhi Traffic Police site. Please enter the OTP in the browser and click submit, then send 'done' via the intervene API."
- After the human responds, continue from the results page.`;

        return `
You are automating a challan extraction workflow across 2 websites.

IMPORTANT RULES:
- You have a tool called "wait_for_human". When you need human help (OTP, CAPTCHA, etc), call this tool with a reason. Do NOT use the "done" action to report that you need help. The wait_for_human tool will pause and return the human's response. After it returns, CONTINUE the workflow from where you left off.
- You have tools "save_challans" and "save_discounts" to save extracted data. Use them as described below.
- Do NOT end the task until ALL phases are complete.
- Use separate browser tabs for each site. Never close a tab until the entire workflow is done.

VEHICLE: ${p.vehicleNumber}
${hasMobileChange ? `TARGET MOBILE: ${p.mobileNumber}` : ""}
${mobileChangeBlock}
========================================
PHASE 1: DELHI TRAFFIC POLICE — Extract Challans
========================================
Open a tab and go to: https://traffic.delhipolice.gov.in/notice/pay-notice/

- Type ${p.vehicleNumber} in the "Vehicle Number" field
- Click "Search Details"

${otpInstructions}

After results load, extract EVERY challan:
- Challan ID (full number)
- Offence description
- Fine amount in Rs
- Date

RULES:
- Scroll through ALL results, check for pagination
- Skip any challan with no amount or amount = 0
- If zero challans found, skip to Phase 2

Once you have ALL challans, call the "save_challans" tool with the data as a JSON array.
Example: [{"challanId":"DL123456","offence":"Red Light Violation","amount":500,"date":"2024-06-15"}]

========================================
PHASE 2: VIRTUAL COURTS — Extract Discounts
========================================
Open a NEW TAB and go to: https://vcourts.gov.in/virtualcourt/index.php

Step 2a — Navigate:
- Click the "Select Department" dropdown
- Select the appropriate department for ${p.vehicleNumber} region
  (Delhi/NCR vehicles like DL, HR, UP → select "Delhi Notice department")
- Click "Proceed Now"
- On the next page, click "Challan/Vehicle No." tab
- Enter vehicle number: ${p.vehicleNumber}

Step 2b — CAPTCHA & Records:

╔══════════════════════════════════════════════════════════════════╗
║  MANDATORY CHECK - RUN THIS *BEFORE* TOUCHING THE CAPTCHA        ║
║                                                                  ║
║  Look at the page RIGHT NOW. Is there a table or list of         ║
║  records already visible? Look for ANY of these signs:           ║
║    - A table with rows of data (challan numbers, amounts, etc)   ║
║    - Text like "no of records", "Offence Details", etc           ║
║    - Offence codes, fine amounts, or challan IDs on screen       ║
║                                                                  ║
║  -> If YES: Records are loaded. CAPTCHA is already solved.       ║
║    SKIP ALL CAPTCHA steps. Go DIRECTLY to Step 2c.               ║
║    DO NOT type anything in the CAPTCHA field.                    ║
║    DO NOT click any submit/search button related to CAPTCHA.     ║
║                                                                  ║
║  -> If NO: Proceed to attempt CAPTCHA below.                     ║
╚══════════════════════════════════════════════════════════════════╝

CAPTCHA attempts (ONLY if no records are visible yet):
  1. Try to read the CAPTCHA image and type the answer. Submit the form.
     captcha_attempt_count = 1

  2. After submitting, wait for the page to update. Then IMMEDIATELY run
     the MANDATORY CHECK above again:
     → Records visible? → CAPTCHA is done. Go to Step 2c. STOP all CAPTCHA work.
     → No records AND captcha_attempt_count < 2? → Try again, increment count.
     → No records AND captcha_attempt_count >= 2? → Call wait_for_human:
       "CAPTCHA needs solving on Virtual Courts. Please solve it in the browser
        and click submit, then send 'done' via intervene API."
       After human responds, go to Step 2c.

ABSOLUTE RULE: Once records/data rows appear on the page, you are FINISHED
with CAPTCHA forever. The CAPTCHA input field will still be visible on the
page — this is normal website behavior. IGNORE IT. Never interact with the
CAPTCHA field or submit button again after records appear. Your ONLY job now
is to extract the data from the records table.

Step 2c — Extract data from Virtual Courts records:

THIS IS THE MOST IMPORTANT STEP. Do not skip it. Do not re-solve CAPTCHA instead of doing this.

The Virtual Courts page shows records in this structure:
- A summary row per record showing: Case No., Challan No., Party Name, Mobile No., and a "View" link
- When you click "View" or if details are already expanded, you see:
  - Offence Code, Offence description, Act/Section
  - "Fine" column — this is the ORIGINAL fine amount
  - "Proposed Fine" row at the bottom — this is the SETTLEMENT/DISCOUNT amount to pay

IMPORTANT: The page does NOT label anything as "discount". The discount is implied:
  - "Fine" = original amount
  - "Proposed Fine" = settlement amount (what the person actually pays)
  - Even if Fine == Proposed Fine (no reduction), you MUST still extract and save it.

For EVERY record on the page:
1. Extract the Challan No. (e.g., "67940444" from "Challan No. : 67940444")
2. Extract the "Fine" value — this is the originalAmount
3. Extract the "Proposed Fine" value — this is the discountAmount (settlement amount)
4. If details are collapsed, click "View" to expand them first

Read EVERY row. Scroll down if needed. Check for pagination ("No. of Records" text).

╔══════════════════════════════════════════════════════════════════╗
║  RULE: If ANY records exist on Virtual Courts, you MUST call     ║
║  save_discounts. NEVER skip it when records are visible.         ║
║  Even if Proposed Fine == Fine (no reduction), STILL save it.    ║
╚══════════════════════════════════════════════════════════════════╝

Call "save_discounts" with a JSON array. Each object must have:
- challanId: the challan number from the record
- discountAmount: the "Proposed Fine" value (settlement amount)
- originalAmount: the "Fine" value

Example: [{"challanId":"67940444","discountAmount":1000,"originalAmount":1000}]

DO NOT proceed to completion without calling save_discounts if ANY records exist.
DO NOT go back to the CAPTCHA. DO NOT refresh the page. Extract what is on screen and save it.

========================================
COMPLETION
========================================
Only NOW use the "done" action. Report:
${hasMobileChange ? "- Whether the mobile number was changed successfully" : ""}
- How many challans were found on Delhi Traffic Police
- How many were saved via save_challans
- How many records were found on Virtual Courts
- How many were saved via save_discounts (with their Proposed Fine and Fine amounts)
`.trim();
    },
};
