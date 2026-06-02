# Role & Context
You are an expert full-stack developer. We are building an intelligent Document Processing / OCR automation feature for our shipping management application. 

The goal is to allow users to upload a "Shipping Instruction (SI)" document, store it, parse its text data using LLM/OCR, and intelligently auto-fill a multi-section form that can contain multiple SI instances under a single vessel call.

---

## Architectural & Functional Requirements

### 1. File Upload & Storage
- Implement a robust file upload mechanism (`Choose Files`).
- The system must upload and securely store the actual document file (PDF or Image scans) to our storage backend, while simultaneously processing the text layer/OCR for data extraction.

### 2. Form Multi-Instance Targeting Context
- **CRITICAL:** A single vessel plan/vessel call can contain **multiple** Shipping Instruction forms sequentially (e.g., "Shipping instruction 1", "Shipping instruction 2").
- The OCR auto-fill action must strictly scope its changes to the **specific active instance** where the user triggered the upload. Do not bleed data or overwrite sibling SI forms unless explicitly intended.

### 3. Smart Autofill & State Guardrails
- **Overwrite Protection:** Before writing any extracted data to a form field, check if that field is already pre-filled with data. If a field has existing content, **do not silently overwrite it**. Instead, halt and trigger a UI notification/modal letting the user decide whether to "Overwrite with OCR data" or "Keep current value" on a per-field or bulk basis.
- **Dropdown Fuzzy Matching:** For fields designated as dropdowns, the extraction logic must find the *closest matching value* from the existing database/dropdown options list.
- **Mismatch Dropdown Notifier:** If the extracted text for a dropdown field does not cleanly align with, or is completely missing from the available dropdown options, set the field to a warning state and display an informational notification to the user (e.g., "Extracted value 'XYZ' not found in system options. Please review manually.").

---

## Data Mapping & Field Specifications

Extract and map data from the uploaded Shipping Instruction document to the form fields according to the strict specification rules below:

| # | Form Field Name | UI Input Type | Extraction & Transformation Rules (Based on SI Document) |
| :--- | :--- | :--- | :--- |
| **1** | Vessel Name | Text Field | Extract from `VESSEL NAME` value (e.g., "MT VAST CORAL"). |
| **2** | ETA | Date Time Picker | Extract or infer based on trip context or document timeline. |
| **3** | Voyage No | Text Field | Extract voyage code if present on the document. |
| **4** | Agent | Dropdown | Match against `MESSRS` or agency metadata (e.g., "PT.BEN LINE AGENCY"). Apply fuzzy matching. |
| **5** | Shipping Instructions No | Text Field | Extract directly from `No.:` row (e.g., "SI/EUP/2026/I/014"). |
| **6** | Document Date | Date Picker | Extract from the bottom-right date stamp (e.g., "19 JANUARY 2026"). Convert to `dd/mm/yyyy` format. |
| **7** | Shipper | Dropdown | Match against the `SHIPPER` company name (e.g., "PT ENERGI UNGGUL PERSADA"). Apply fuzzy matching. |
| **8** | Loading Port | Dropdown | Infer from `SHIPMENT FROM` field (e.g., "BONTANG, INDONESIA"). |
| **9** | Surveyor | Dropdown | Extract independent surveyor details if mentioned in text body. |
| **10** | Commodity | Dropdown | Match against `DESCR. OF GOOD` (e.g., "REFINED POME OIL"). |
| **11** | QTY | Text Field | Extract numeric value from `QUANTITY` (e.g., "5,000"). |
| **12** | Unit | Dropdown | Extract unit of measurement from `QUANTITY` string (e.g., "MT" or "MTS"). |
| **13** | Contract No | Text Field | Locate and extract contract reference numbers if present in text blocks. |
| **14** | PO No | Text Field | Locate and extract Purchase Order numbers if present. |
| **15** | SO No | Text Field | Locate and extract Sales Order numbers if present. |
| **16** | B/L Split | Text Field | Extract directly from `BL SPLIT` field (e.g., "1 X 5,000 MTS"). |
| **17** | Bill of Lading Clause | Text Field | Extract text detailing original/non-negotiable splits from `BILL OF LADING`. |
| **18** | Consignee | Text Field | Extract entire structured block under `CONSIGNEE` (e.g., "TO ORDER"). |
| **19** | Notify Party | Text Field | Extract full name and address blocks under `NOTIFY PARTY` (e.g., "ADAMANT ECODEV S.R.L..."). |
| **20** | BL Indicated | Text Field | Extract verbatim from `BL INDICATED` row (e.g., "FREIGHT PREPAID, CLEAN ON BOARD"). |
| **21** | Note | Text Field | Catch-all for extra document clauses, freight terms (e.g., "PREPAID"), or miscellaneous terms. |

---

## Expected Output
Please break down the implementation steps logically:
1. **Backend/API modifications** for handling file storage and OCR parsing metadata payload.
2. **State management updates** to safely target `Shipping instruction [X]` without mutating other forms, handling dirty/pre-filled check logic.
3. **UI/UX updates** for the mismatch alerts, dropdown warnings, and overwrite conflict resolution modals.

Let's write clean, production-grade, modular code following these instructions. Let's begin!