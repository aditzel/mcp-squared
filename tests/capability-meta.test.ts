import { describe, expect, test } from "bun:test";
import { CAPABILITY_IDS } from "@/capabilities/inference";
import { capabilitySummary, capabilityTitle } from "@/utils/capability-meta";

describe("capabilityTitle", () => {
  test("converts underscore-separated IDs to Title Case", () => {
    expect(capabilityTitle("code_search")).toBe("Code Search");
    expect(capabilityTitle("browser_automation")).toBe("Browser Automation");
    expect(capabilityTitle("issue_tracking")).toBe("Issue Tracking");
    expect(capabilityTitle("cms_content")).toBe("Cms Content");
    expect(capabilityTitle("ai_media_generation")).toBe("Ai Media Generation");
    expect(capabilityTitle("hosting_deploy")).toBe("Hosting Deploy");
    expect(capabilityTitle("time_util")).toBe("Time Util");
  });

  test("handles single-word IDs", () => {
    expect(capabilityTitle("docs")).toBe("Docs");
    expect(capabilityTitle("design")).toBe("Design");
    expect(capabilityTitle("research")).toBe("Research");
    expect(capabilityTitle("general")).toBe("General");
  });

  test("handles unknown capability IDs gracefully", () => {
    expect(capabilityTitle("some_new_capability")).toBe("Some New Capability");
    expect(capabilityTitle("x")).toBe("X");
  });

  test("produces a title for every known CAPABILITY_ID", () => {
    for (const id of CAPABILITY_IDS) {
      const title = capabilityTitle(id);
      expect(title.length).toBeGreaterThan(0);
      // First character of each word should be uppercase
      for (const word of title.split(" ")) {
        expect(word[0]).toBe(word[0]?.toUpperCase());
      }
    }
  });
});

describe("capabilitySummary", () => {
  const EXPECTED_SUMMARIES: Record<string, string> = {
    code_search: "Search and retrieve source-code context.",
    docs: "Query and read technical documentation.",
    browser_automation: "Automate browser interactions and diagnostics.",
    issue_tracking: "Work with issues, tickets, and project tracking.",
    cms_content: "Manage content and CMS resources.",
    design: "Create and inspect design artifacts and visuals.",
    ai_media_generation: "Generate and edit images and media using AI models.",
    hosting_deploy:
      "Manage deployments, hosting, and infrastructure operations.",
    time_util: "Resolve time, timezone, and date utilities.",
    research: "Run web/research collection and synthesis operations.",
  };

  test("returns a specific summary for each non-general capability", () => {
    for (const [capability, expected] of Object.entries(EXPECTED_SUMMARIES)) {
      expect(capabilitySummary(capability)).toBe(expected);
    }
  });

  test("returns generic fallback for 'general' capability", () => {
    expect(capabilitySummary("general")).toBe(
      "Run general-purpose capability actions.",
    );
  });

  test("returns generic fallback for unknown capability IDs", () => {
    expect(capabilitySummary("unknown_capability")).toBe(
      "Run general-purpose capability actions.",
    );
    expect(capabilitySummary("")).toBe(
      "Run general-purpose capability actions.",
    );
  });

  test("every CAPABILITY_ID has a non-empty summary", () => {
    for (const id of CAPABILITY_IDS) {
      const summary = capabilitySummary(id);
      expect(summary.length).toBeGreaterThan(0);
      // Every summary should end with a period
      expect(summary.endsWith(".")).toBe(true);
    }
  });

  test("every non-general CAPABILITY_ID has a specific (non-default) summary", () => {
    const defaultSummary = "Run general-purpose capability actions.";
    const nonGeneralIds = CAPABILITY_IDS.filter((id) => id !== "general");

    for (const id of nonGeneralIds) {
      const summary = capabilitySummary(id);
      expect(summary).not.toBe(defaultSummary);
    }
  });

  test("EXPECTED_SUMMARIES covers all non-general CAPABILITY_IDS", () => {
    const nonGeneralIds = CAPABILITY_IDS.filter((id) => id !== "general");
    const coveredIds = Object.keys(EXPECTED_SUMMARIES).sort();
    expect(coveredIds).toEqual([...nonGeneralIds].sort());
  });
});
