# Importing a site cutsheet

Choose **File → Import cutsheet CSV…**, select your CSV, review the column mapping and preview, then choose **Create design**. This creates a new project and saves the previous design in **Open projects**. **Import JSON** still restores a complete project exported by this app.

The supplied `test cutsheet.csv` automatically maps:

| Column | Header | Meaning |
| --- | --- | --- |
| D | a_end_interface | First device and port |
| E | b_end_interface | Second device and port |
| F | capacity | Connection speed in Gbps |
| C | state | Optional connection state |
| B | Link Type | Optional connection type |

Each endpoint uses `device_port`, split at the **last underscore**. For example, `dcfn-dist-r101_xe-0/0/52:0` creates device `dcfn-dist-r101` with port `xe-0/0/52:0`. Device names can contain underscores. Breakout suffixes are preserved as port names; the importer does not infer their parent cage or breakout hardware.

Numeric speeds are Gbps. Unit-bearing values such as `10G`, `100 Gbps`, and `10000 Mbps` are also accepted. The imported speed appears in each endpoint's port specification and the link label. Optional state and link type also appear in the link label; all states, including RESERVED, are imported.

The sample produces **49 devices and 48 connections: 46 at 10 Gbps and two at 100 Gbps**. The most-connected device appears on the root schematic, with the remaining devices organized into four child sheets.

**Create draft rack layout** is enabled by default. For this sample it creates five 42U racks with generic 1U devices and automatic U positions, making Layout and 3D immediately available. These are suggested placements: the CSV contains no rack locations, device dimensions, hardware models, exact optics, or cable media. Adjust the physical design and assign optics and cable routes before treating it as a site plan. Unrouted links appear as airwires, and missing-optic and unrouted-link warnings are expected. Turn the checkbox off to put devices in the Unplaced bin for manual placement instead.

The preview blocks malformed endpoints, invalid speeds, reused ports, and conflicting connections. Identical duplicate connections, including reversed endpoint order, are skipped. You can remap columns before creating the design. Files must have a header row and consistent column counts; CSV quoting, escaped quotes, and multiline quoted fields are supported. The current limit is 5 MB and 10,000 rows. Excel workbooks must first be saved as CSV.

Each import creates a separate project; it does not update or merge an existing design.
