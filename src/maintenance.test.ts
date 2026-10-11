import { describe, expect, it } from "vitest";
import { maintenanceHeading, maintenanceHtml } from "./maintenance.js";

describe("Conservative maintenance recognition", () => {
  it.each(["Maintenance", "Anaplan - Maintenance", "Anaplan is down for maintenance", "Scheduled maintenance", "Anaplan is undergoing planned maintenance", "Maintenance in progress"])("recognises the heading %s", heading => {
    expect(maintenanceHeading(heading)).toBe(true);
    expect(maintenanceHtml(`<html><title>${heading}</title></html>`)).toBe(true);
    expect(maintenanceHtml(`<html><h1><span>${heading}</span></h1></html>`)).toBe(true);
  });
  it.each(["Internal server error", "Service unavailable", "Maintenance planning", "Error reading Maintenance", "No maintenance scheduled", "Anaplan is unavailable"])("leaves an ordinary title alone: %s", heading => {
    expect(maintenanceHeading(heading)).toBe(false);
    expect(maintenanceHtml(`<h1>${heading}</h1>`)).toBe(false);
  });
  it("ignores paragraphs, scripts, comments and JSON that only mention maintenance", () => {
    for (const body of ['<p>Maintenance</p>', '<script>"<h1>Maintenance</h1>"</script>', '<!-- <title>Maintenance</title> -->', '{"title":"<h1>Maintenance</h1>"}']) {
      expect(maintenanceHtml(body)).toBe(false);
    }
  });
});
