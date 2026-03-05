import { describe, expect, test } from "bun:test";
import {
  groupNamespacesByCapability,
  inferNamespaceCapability,
} from "@/capabilities/inference";

describe("capability inference", () => {
  test("infers code_search for auggie codebase retrieval tooling", () => {
    const capability = inferNamespaceCapability("auggie", [
      {
        name: "codebase-retrieval",
        description:
          "Search source code and symbols across the repository context index",
        inputSchema: {
          type: "object",
          properties: {
            information_request: { type: "string" },
            directory_path: { type: "string" },
          },
        },
      },
    ]);

    expect(capability).toBe("code_search");
  });

  test("capability override takes precedence over heuristic", () => {
    const capability = inferNamespaceCapability(
      "auggie",
      [
        {
          name: "codebase-retrieval",
          description: "Search source code and symbols",
          inputSchema: { type: "object" },
        },
      ],
      {
        auggie: "docs",
      },
    );

    expect(capability).toBe("docs");
  });

  test("groups namespaces by inferred capability", () => {
    const groups = groupNamespacesByCapability(
      [
        {
          namespace: "auggie",
          tools: [
            { name: "codebase-retrieval", inputSchema: { type: "object" } },
          ],
        },
        {
          namespace: "time",
          tools: [{ name: "convert_time", inputSchema: { type: "object" } }],
        },
      ],
      {},
    );

    expect(groups.byNamespace).toEqual({
      auggie: "code_search",
      time: "time_util",
    });
    expect(groups.grouped.code_search).toEqual(["auggie"]);
    expect(groups.grouped.time_util).toEqual(["time"]);
  });
});

/**
 * Heuristic misclassification regression cases.
 *
 * These document the 5 known failures of the regex+score heuristic (62% accuracy).
 * Each test asserts the CURRENT (wrong) heuristic output, so they'll break if
 * the heuristic accidentally changes — which is intentional.
 *
 * When hybrid inference fixes these, the tests can be updated to expect the
 * correct capability instead.
 */
describe("heuristic misclassification regression cases", () => {
  test("Notion: misclassified as browser_automation (should be cms_content)", () => {
    // "page" means wiki page, not browser page — semantic collision
    const capability = inferNamespaceCapability("notion", [
      { name: "create_page", description: "Create a new page in Notion" },
      {
        name: "search_pages",
        description: "Search across all pages in the workspace",
      },
      {
        name: "update_page",
        description: "Update page properties and content blocks",
      },
    ]);
    expect(capability).toBe("browser_automation");
  });

  test("Sentry: misclassified as issue_tracking (should be general)", () => {
    // "issue" means error/exception, not project management ticket
    const capability = inferNamespaceCapability("sentry", [
      { name: "list_issues", description: "List error issues in a project" },
      { name: "get_issue", description: "Get details of a specific issue" },
      { name: "resolve_issue", description: "Resolve an issue" },
    ]);
    expect(capability).toBe("issue_tracking");
  });

  test("Prisma: misclassified as cms_content (should be general)", () => {
    // "schema" and "migration" are database concepts, not CMS concepts
    const capability = inferNamespaceCapability("prisma", [
      {
        name: "introspect_schema",
        description: "Introspect the database schema",
      },
      {
        name: "create_migration",
        description: "Create a new database migration",
      },
      { name: "apply_migration", description: "Apply pending migrations" },
    ]);
    expect(capability).toBe("cms_content");
  });

  test("shadcn: correctly classified as docs (fixed — was design)", () => {
    // Fixed: shadcn is a code component registry → docs, not design
    const capability = inferNamespaceCapability("shadcn", [
      { name: "add_component", description: "Add a UI component to project" },
      {
        name: "list_components",
        description: "List available shadcn/ui components",
      },
    ]);
    expect(capability).toBe("docs");
  });

  test("Supabase: misclassified as issue_tracking (taxonomy gap — no database category)", () => {
    // Database-as-a-service doesn't map to any of the 10 categories
    const capability = inferNamespaceCapability("supabase", [
      { name: "list_projects", description: "List all Supabase projects" },
      { name: "run_query", description: "Execute a SQL query" },
      {
        name: "get_table",
        description: "Get table schema and row count",
        inputSchema: {
          type: "object",
          properties: {
            project_id: { type: "string" },
            table_name: { type: "string" },
          },
        },
      },
    ]);
    expect(capability).toBe("issue_tracking");
  });

  test("wavespeed-cli-mcp: correctly classified as ai_media_generation (fixed — was design)", () => {
    // Fixed: wavespeed is an AI image generation service, not a design tool.
    // The word "image" in tool descriptions was triggering design's /\bimage\b/ pattern.
    const capability = inferNamespaceCapability("wavespeed-cli-mcp", [
      {
        name: "generate",
        description: "Generate images from text prompts using Wavespeed AI",
      },
      {
        name: "edit",
        description: "Edit images using text prompts with Wavespeed AI",
      },
      {
        name: "list_models",
        description: "List available Wavespeed AI models",
      },
    ]);
    expect(capability).toBe("ai_media_generation");
  });
});
