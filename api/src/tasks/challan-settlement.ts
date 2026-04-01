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
                        'array of objects, each with: challanId (string), offence (string), amount (number in Rs), date (string YYYY-MM-DD). ' +
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
                    type: "array",
                    description:
                        'array of discount objects, each with: challanId (string), discountAmount (number in Rs), originalAmount (number in Rs). ' +
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
- NEVER use JavaScript evaluate() to scrape or extract data from a page. Always read data visually from the screen.

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

STEP A — Select department and proceed:
You will see a "Select Department" dropdown and a "Proceed Now" button.
Select the correct department for vehicle ${p.vehicleNumber}:
  DL, HR → "Delhi(Traffic Department)"
  UP → matching UP department
  Other → pick the matching Traffic/Transport department for the state.
Click "Proceed Now".

STEP B — Search by vehicle number:
A new page loads with 4 tab buttons: "Mobile Number", "CNR Number", "Party Name", "Challan/Vehicle No."
Click "Challan/Vehicle No.".
Type ${p.vehicleNumber} in the "Vehicle Number" field.
Read the CAPTCHA image and type what you see in the "Enter Captcha" field.
Click "Submit".
If CAPTCHA fails, try again (up to 5 attempts).
After 5 failures, call wait_for_human: "CAPTCHA needs solving on Virtual Courts. Please solve it, click submit, then send 'done'."

STEP C — Extract results:

*** CRITICAL: Before EVER touching the CAPTCHA form, FIRST scroll down and look at the page. If you see text "No. of Records" followed by a number >= 1 and a results table is visible, the data is ALREADY loaded — do NOT re-submit the CAPTCHA. Skip straight to reading the table below. ***

Once results are visible, you will see "No. of Records :- N" and a table with columns: Sr.No., Offence Details, View.

For each row:
1. Click the "View" link to expand that record (if not already expanded).
2. Read the "Challan No." from the row — this is your challanId.
3. In the expanded section, find the "Fine" column — this number is your originalAmount.
4. Below the expanded section, find "Proposed Fine" — this number is your discountAmount.

Scroll through the entire page to make sure you have read every record.
Include every record, even if Fine and Proposed Fine are the same amount.
If "No. of Records :- 0", skip to COMPLETION.

STEP D — Save:
Call "save_discounts" with all records:
[{"challanId":"DL19016240430095546","discountAmount":300,"originalAmount":300}]

========================================
COMPLETION
========================================
Only NOW use the "done" action. Report:
${hasMobileChange ? "- Whether the mobile number was changed successfully" : ""}
- How many challans were found on Delhi Traffic Police
- How many were saved via save_challans
- How many records were found on Virtual Courts
- How many were saved via save_discounts
`.trim();
    },
};
