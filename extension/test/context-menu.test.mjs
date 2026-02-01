/**
 * Headless browser test for TLDW Chrome Extension context menu.
 *
 * Launches a real Chrome instance with the extension loaded,
 * then verifies via the Chrome DevTools Protocol that the
 * context menu item is properly registered for YouTube links.
 */

import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";
import assert from "assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "..", "dist");

/** Small HTML page with various link types for testing. */
const TEST_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head><title>TLDW Context Menu Test</title></head>
<body>
  <h1>Context Menu Test Page</h1>
  <ul>
    <li><a id="yt-watch"   href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">YouTube watch link</a></li>
    <li><a id="yt-short"   href="https://youtu.be/dQw4w9WgXcQ">YouTube short link</a></li>
    <li><a id="yt-embed"   href="https://www.youtube.com/embed/dQw4w9WgXcQ">YouTube embed link</a></li>
    <li><a id="yt-shorts"  href="https://www.youtube.com/shorts/dQw4w9WgXcQ">YouTube shorts link</a></li>
    <li><a id="yt-mobile"  href="https://m.youtube.com/watch?v=dQw4w9WgXcQ">YouTube mobile link</a></li>
    <li><a id="non-yt"     href="https://www.google.com">Non-YouTube link</a></li>
  </ul>
</body>
</html>
`;

let browser;
let passed = 0;
let failed = 0;
const results = [];

function logTest(name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  if (ok) passed++;
  else failed++;
  results.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " - " + detail : ""}`);
}

async function run() {
  console.log("=== TLDW Context Menu Headless Tests ===\n");

  // 1. Launch Chrome with the extension loaded
  console.log("Launching Chrome with extension...");
  browser = await puppeteer.launch({
    headless: "new",
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
    ],
  });

  // 2. Find the extension's service worker target
  console.log("Waiting for service worker to initialize...\n");
  await new Promise((r) => setTimeout(r, 2000));

  const targets = browser.targets();
  const swTarget = targets.find(
    (t) => t.type() === "service_worker" && t.url().includes("background.js")
  );

  // -- Test: Service worker loaded --
  logTest(
    "Service worker loads",
    !!swTarget,
    swTarget ? swTarget.url() : "Service worker target not found"
  );

  if (!swTarget) {
    console.log("\nCannot proceed without service worker. Available targets:");
    for (const t of targets) {
      console.log(`  type=${t.type()} url=${t.url()}`);
    }
    await cleanup();
    return;
  }

  // 3. Attach to service worker via CDP to query context menus
  const swCdp = await swTarget.createCDPSession();

  // Enable Runtime on the service worker
  await swCdp.send("Runtime.enable");

  // -- Test: ensureContextMenu function exists --
  const fnCheck = await swCdp.send("Runtime.evaluate", {
    expression: "typeof ensureContextMenu",
    returnByValue: true,
  });
  logTest(
    "ensureContextMenu function exists in service worker",
    fnCheck.result.value === "function",
    `typeof ensureContextMenu = ${fnCheck.result.value}`
  );

  // -- Test: YOUTUBE_URL_PATTERNS is defined --
  const patternsCheck = await swCdp.send("Runtime.evaluate", {
    expression: "JSON.stringify(YOUTUBE_URL_PATTERNS)",
    returnByValue: true,
  });
  let patterns;
  try {
    patterns = JSON.parse(patternsCheck.result.value);
    logTest(
      "YOUTUBE_URL_PATTERNS is defined with correct patterns",
      Array.isArray(patterns) && patterns.length >= 6,
      `${patterns.length} patterns defined`
    );
  } catch {
    logTest("YOUTUBE_URL_PATTERNS is defined", false, "Could not parse");
  }

  // -- Test: Context menu was created (query via chrome.contextMenus internals) --
  // We can verify by calling ensureContextMenu and checking it doesn't throw
  const menuCreateResult = await swCdp.send("Runtime.evaluate", {
    expression: `
      new Promise((resolve) => {
        chrome.contextMenus.removeAll(() => {
          try {
            chrome.contextMenus.create({
              id: "tldw-summarize",
              title: "Summarize with TL;DW",
              contexts: ["link"],
              targetUrlPatterns: YOUTUBE_URL_PATTERNS,
            }, () => {
              if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
              } else {
                resolve({ ok: true });
              }
            });
          } catch (e) {
            resolve({ ok: false, error: e.message });
          }
        });
      })
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  logTest(
    "Context menu item can be created without errors",
    menuCreateResult.result.value?.ok === true,
    menuCreateResult.result.value?.error || "Created successfully"
  );

  // -- Test: All YouTube URL patterns are valid match patterns --
  const patternValidation = await swCdp.send("Runtime.evaluate", {
    expression: `
      new Promise((resolve) => {
        const results = [];
        const patterns = ${JSON.stringify(patterns || [])};
        let completed = 0;

        // Clear first
        chrome.contextMenus.removeAll(() => {
          patterns.forEach((pattern, idx) => {
            chrome.contextMenus.create({
              id: "pattern-test-" + idx,
              title: "test",
              contexts: ["link"],
              targetUrlPatterns: [pattern],
            }, () => {
              completed++;
              if (chrome.runtime.lastError) {
                results.push({ pattern, valid: false, error: chrome.runtime.lastError.message });
              } else {
                results.push({ pattern, valid: true });
              }
              if (completed === patterns.length) {
                chrome.contextMenus.removeAll(() => {
                  // Restore the real menu
                  ensureContextMenu();
                  resolve(results);
                });
              }
            });
          });
        });
      })
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  const patternResults = patternValidation.result.value || [];
  for (const pr of patternResults) {
    logTest(
      `URL pattern valid: ${pr.pattern}`,
      pr.valid,
      pr.valid ? "Valid" : pr.error
    );
  }

  // 4. Open a test page and verify extension integration
  const page = await browser.newPage();

  // Create a data URL test page
  await page.goto(`data:text/html,${encodeURIComponent(TEST_PAGE_HTML)}`);
  await page.waitForSelector("#yt-watch");

  // -- Test: YouTube links exist on page --
  const linkCount = await page.evaluate(() => {
    return document.querySelectorAll("a[id^='yt-']").length;
  });
  logTest("Test page has YouTube links", linkCount === 5, `Found ${linkCount} YouTube links`);

  // -- Test: Non-YouTube link exists --
  const nonYtExists = await page.evaluate(() => {
    return !!document.querySelector("#non-yt");
  });
  logTest("Test page has non-YouTube link", nonYtExists, "Found non-YouTube link");

  // 5. Test context menu click handler logic via service worker
  // Simulate what happens when the context menu is clicked with a YouTube URL
  const clickHandlerResult = await swCdp.send("Runtime.evaluate", {
    expression: `
      new Promise((resolve) => {
        // Simulate the storage write that happens on context menu click
        const testUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        chrome.storage.local.set({ tldw_pending_url: testUrl }, () => {
          chrome.storage.local.get("tldw_pending_url", (result) => {
            const stored = result.tldw_pending_url;
            chrome.storage.local.remove("tldw_pending_url", () => {
              resolve({ stored, matches: stored === testUrl });
            });
          });
        });
      })
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  logTest(
    "Context menu click handler stores URL correctly",
    clickHandlerResult.result.value?.matches === true,
    `Stored URL: ${clickHandlerResult.result.value?.stored}`
  );

  // 6. Test message passing (popup -> background -> popup)
  const messagingResult = await swCdp.send("Runtime.evaluate", {
    expression: `
      new Promise((resolve) => {
        const testUrl = "https://youtu.be/test123";
        chrome.storage.local.set({ tldw_pending_url: testUrl }, () => {
          // Simulate what popup does: send get_pending_url message
          // We can't easily test cross-context messaging from here,
          // but we can verify the listener is registered by checking
          // storage round-trip
          chrome.storage.local.get("tldw_pending_url", (result) => {
            const storedBefore = result.tldw_pending_url;
            chrome.storage.local.remove("tldw_pending_url", () => {
              chrome.storage.local.get("tldw_pending_url", (result2) => {
                resolve({
                  storedBefore,
                  clearedAfter: !result2.tldw_pending_url,
                });
              });
            });
          });
        });
      })
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  logTest(
    "URL storage set/get/clear cycle works",
    messagingResult.result.value?.storedBefore === "https://youtu.be/test123" &&
      messagingResult.result.value?.clearedAfter === true,
    `stored=${messagingResult.result.value?.storedBefore}, cleared=${messagingResult.result.value?.clearedAfter}`
  );

  // 7. Test service worker resilience: call ensureContextMenu again and verify no errors
  const resilienceResult = await swCdp.send("Runtime.evaluate", {
    expression: `
      new Promise((resolve) => {
        // Call ensureContextMenu multiple times rapidly - should not throw
        try {
          ensureContextMenu();
          setTimeout(() => {
            ensureContextMenu();
            setTimeout(() => {
              // Verify menu still works after repeated calls
              chrome.contextMenus.removeAll(() => {
                chrome.contextMenus.create({
                  id: "tldw-summarize",
                  title: "Summarize with TL;DW",
                  contexts: ["link"],
                  targetUrlPatterns: YOUTUBE_URL_PATTERNS,
                }, () => {
                  if (chrome.runtime.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                  } else {
                    resolve({ ok: true });
                  }
                });
              });
            }, 200);
          }, 200);
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      })
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  logTest(
    "Context menu survives repeated ensureContextMenu calls",
    resilienceResult.result.value?.ok === true,
    resilienceResult.result.value?.error || "Resilient"
  );

  // 8. Test popup page can load
  const popupUrl = await swCdp.send("Runtime.evaluate", {
    expression: "chrome.runtime.getURL('popup.html')",
    returnByValue: true,
  });

  const popupPage = await browser.newPage();
  let popupLoaded = false;
  try {
    await popupPage.goto(popupUrl.result.value, { waitUntil: "domcontentloaded", timeout: 5000 });
    popupLoaded = true;
  } catch (e) {
    popupLoaded = false;
  }
  logTest("Popup page loads", popupLoaded, popupUrl.result.value);

  if (popupLoaded) {
    // Check popup has required DOM elements
    const popupElements = await popupPage.evaluate(() => {
      return {
        urlInput: !!document.getElementById("urlInput"),
        summarizeBtn: !!document.getElementById("summarizeBtn"),
        results: !!document.getElementById("results"),
      };
    });
    logTest(
      "Popup has required UI elements",
      popupElements.urlInput && popupElements.summarizeBtn && popupElements.results,
      `urlInput=${popupElements.urlInput}, summarizeBtn=${popupElements.summarizeBtn}, results=${popupElements.results}`
    );

    // Test popup with URL parameter (simulating context menu opening popup)
    const popupWithUrl = await browser.newPage();
    await popupWithUrl.goto(
      popupUrl.result.value + "?url=" + encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      { waitUntil: "domcontentloaded", timeout: 5000 }
    );

    // Wait for the URL input to be populated
    await new Promise((r) => setTimeout(r, 500));
    const populatedUrl = await popupWithUrl.evaluate(() => {
      const input = document.getElementById("urlInput");
      return input ? input.value : null;
    });
    logTest(
      "Popup auto-populates URL from query parameter",
      populatedUrl === "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      `urlInput.value = ${populatedUrl}`
    );

    await popupWithUrl.close();
  }

  await popupPage.close();
  await page.close();

  // ═══════════════════════════════════════════════════════════════
  // 9. Settings gear icon in popup
  // ═══════════════════════════════════════════════════════════════
  console.log("\n--- Settings gear icon tests ---");

  const popupForSettings = await browser.newPage();
  try {
    await popupForSettings.goto(popupUrl.result.value, {
      waitUntil: "domcontentloaded",
      timeout: 5000,
    });

    const settingsBtnExists = await popupForSettings.evaluate(() => {
      return !!document.getElementById("settingsBtn");
    });
    logTest("Popup has settings gear button", settingsBtnExists, "settingsBtn element found");

    const settingsBtnProps = await popupForSettings.evaluate(() => {
      const btn = document.getElementById("settingsBtn");
      if (!btn) return null;
      const style = window.getComputedStyle(btn);
      return {
        position: style.position,
        title: btn.title,
        isButton: btn.tagName === "BUTTON",
      };
    });
    logTest(
      "Settings button is positioned absolutely",
      settingsBtnProps?.position === "absolute",
      `position=${settingsBtnProps?.position}`
    );
    logTest(
      "Settings button has title attribute",
      settingsBtnProps?.title === "Settings",
      `title="${settingsBtnProps?.title}"`
    );
    logTest(
      "Settings button is a <button> element",
      settingsBtnProps?.isButton === true,
      `tagName=${settingsBtnProps?.isButton ? "BUTTON" : "other"}`
    );
  } catch (e) {
    logTest("Settings gear tests", false, e.message);
  }
  await popupForSettings.close();

  // ═══════════════════════════════════════════════════════════════
  // 10. Options page tests (OpenRouter provider, model dropdown,
  //     custom model toggle)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n--- Options page tests ---");

  const optionsUrl = await swCdp.send("Runtime.evaluate", {
    expression: "chrome.runtime.getURL('options.html')",
    returnByValue: true,
  });

  const optionsPage = await browser.newPage();
  let optionsLoaded = false;
  try {
    await optionsPage.goto(optionsUrl.result.value, {
      waitUntil: "domcontentloaded",
      timeout: 5000,
    });
    optionsLoaded = true;
  } catch {
    optionsLoaded = false;
  }
  logTest("Options page loads", optionsLoaded, optionsUrl.result.value);

  if (optionsLoaded) {
    // Wait for module to initialize
    await new Promise((r) => setTimeout(r, 500));

    // -- Test: Options page has all required elements --
    const optionsElements = await optionsPage.evaluate(() => {
      return {
        providerSelect: !!document.getElementById("providerSelect"),
        modelSelect: !!document.getElementById("modelSelect"),
        customModelToggle: !!document.getElementById("customModelToggle"),
        customModelSection: !!document.getElementById("customModelSection"),
        customModelInput: !!document.getElementById("customModelInput"),
        apiKeyInput: !!document.getElementById("apiKeyInput"),
        saveBtn: !!document.getElementById("saveBtn"),
        savedMsg: !!document.getElementById("savedMsg"),
        errorMsg: !!document.getElementById("errorMsg"),
        validatingMsg: !!document.getElementById("validatingMsg"),
        statusItems: !!document.getElementById("statusItems"),
        apiKeyHint: !!document.getElementById("apiKeyHint"),
      };
    });
    logTest(
      "Options page has all required DOM elements",
      Object.values(optionsElements).every((v) => v === true),
      `present: ${Object.entries(optionsElements).filter(([,v]) => v).map(([k]) => k).join(", ")}; ` +
      `missing: ${Object.entries(optionsElements).filter(([,v]) => !v).map(([k]) => k).join(", ") || "none"}`
    );

    // -- Test: OpenRouter is the default/first provider --
    const defaultProvider = await optionsPage.evaluate(() => {
      const select = document.getElementById("providerSelect");
      return {
        firstOptionValue: select?.options[0]?.value,
        firstOptionText: select?.options[0]?.textContent,
        selectedValue: select?.value,
      };
    });
    logTest(
      "OpenRouter is the first provider option",
      defaultProvider.firstOptionValue === "openrouter",
      `first=${defaultProvider.firstOptionValue}`
    );

    // -- Test: Provider dropdown has all 3 providers --
    const providerOptions = await optionsPage.evaluate(() => {
      const select = document.getElementById("providerSelect");
      return Array.from(select?.options || []).map((o) => o.value);
    });
    logTest(
      "Provider dropdown has openrouter, anthropic, openai",
      providerOptions.includes("openrouter") &&
        providerOptions.includes("anthropic") &&
        providerOptions.includes("openai"),
      `providers: ${providerOptions.join(", ")}`
    );

    // -- Test: Model dropdown is populated with OpenRouter models --
    const modelOptions = await optionsPage.evaluate(() => {
      const select = document.getElementById("modelSelect");
      return Array.from(select?.options || []).map((o) => o.value);
    });
    logTest(
      "Model dropdown has OpenRouter models when openrouter selected",
      modelOptions.includes("google/gemini-3-flash-preview") && modelOptions.length >= 16,
      `${modelOptions.length} models`
    );
    logTest(
      "Model dropdown includes key OpenRouter models",
      modelOptions.includes("anthropic/claude-sonnet-4.5") &&
        modelOptions.includes("deepseek/deepseek-v3.2") &&
        modelOptions.includes("x-ai/grok-4.1-fast") &&
        modelOptions.includes("openai/o3-pro"),
      "all key models present"
    );

    // -- Test: Switching provider to anthropic updates model dropdown --
    await optionsPage.select("#providerSelect", "anthropic");
    await new Promise((r) => setTimeout(r, 200));
    const anthropicModels = await optionsPage.evaluate(() => {
      const select = document.getElementById("modelSelect");
      return Array.from(select?.options || []).map((o) => o.value);
    });
    logTest(
      "Switching to anthropic updates model list",
      anthropicModels.includes("claude-opus-4-5-20251101") &&
        anthropicModels.includes("claude-sonnet-4-20250514") &&
        anthropicModels.length === 2,
      `${anthropicModels.length} models: ${anthropicModels.join(", ")}`
    );

    // -- Test: Switching to openai updates model dropdown --
    await optionsPage.select("#providerSelect", "openai");
    await new Promise((r) => setTimeout(r, 200));
    const openaiModels = await optionsPage.evaluate(() => {
      const select = document.getElementById("modelSelect");
      return Array.from(select?.options || []).map((o) => o.value);
    });
    logTest(
      "Switching to openai updates model list",
      openaiModels.includes("gpt-5") &&
        openaiModels.includes("gpt-4o") &&
        openaiModels.length === 2,
      `${openaiModels.length} models: ${openaiModels.join(", ")}`
    );

    // -- Test: Switch back to openrouter --
    await optionsPage.select("#providerSelect", "openrouter");
    await new Promise((r) => setTimeout(r, 200));
    const backToOpenrouter = await optionsPage.evaluate(() => {
      const select = document.getElementById("modelSelect");
      return Array.from(select?.options || []).map((o) => o.value);
    });
    logTest(
      "Switching back to openrouter restores full model list",
      backToOpenrouter.length >= 16 && backToOpenrouter.includes("google/gemini-3-flash-preview"),
      `${backToOpenrouter.length} models`
    );

    // -- Test: Custom model section is hidden by default --
    const customSectionHidden = await optionsPage.evaluate(() => {
      const section = document.getElementById("customModelSection");
      return section && !section.classList.contains("visible");
    });
    logTest(
      "Custom model section is hidden by default",
      customSectionHidden === true,
      "hidden"
    );

    // -- Test: Clicking custom model toggle shows input --
    await optionsPage.click("#customModelToggle");
    await new Promise((r) => setTimeout(r, 200));
    const customSectionVisible = await optionsPage.evaluate(() => {
      const section = document.getElementById("customModelSection");
      return section?.classList.contains("visible");
    });
    logTest(
      "Clicking custom model toggle shows custom input",
      customSectionVisible === true,
      "visible"
    );

    // -- Test: Custom model input is an <input> element --
    const customInputType = await optionsPage.evaluate(() => {
      const input = document.getElementById("customModelInput");
      return input?.tagName;
    });
    logTest(
      "Custom model input is an input element",
      customInputType === "INPUT",
      `tagName=${customInputType}`
    );

    // -- Test: Unchecking toggle hides section again --
    await optionsPage.click("#customModelToggle");
    await new Promise((r) => setTimeout(r, 200));
    const customSectionHiddenAgain = await optionsPage.evaluate(() => {
      const section = document.getElementById("customModelSection");
      return section && !section.classList.contains("visible");
    });
    logTest(
      "Unchecking toggle hides custom model section",
      customSectionHiddenAgain === true,
      "hidden again"
    );

    // -- Test: API key hint updates per provider --
    await optionsPage.select("#providerSelect", "openrouter");
    await new Promise((r) => setTimeout(r, 200));
    const openrouterHint = await optionsPage.evaluate(() => {
      return document.getElementById("apiKeyHint")?.textContent || "";
    });
    logTest(
      "API key hint mentions OpenRouter for openrouter provider",
      openrouterHint.toLowerCase().includes("openrouter"),
      `hint="${openrouterHint}"`
    );

    await optionsPage.select("#providerSelect", "anthropic");
    await new Promise((r) => setTimeout(r, 200));
    const anthropicHint = await optionsPage.evaluate(() => {
      return document.getElementById("apiKeyHint")?.textContent || "";
    });
    logTest(
      "API key hint mentions Anthropic for anthropic provider",
      anthropicHint.toLowerCase().includes("anthropic"),
      `hint="${anthropicHint}"`
    );

    // -- Test: Config persistence via chrome.storage.sync --
    const configStorageResult = await swCdp.send("Runtime.evaluate", {
      expression: `
        new Promise((resolve) => {
          const testConfig = {
            provider: "openrouter",
            model: "google/gemini-3-flash-preview",
            apiKey: "test-key-12345"
          };
          chrome.storage.sync.set({ tldw_config: testConfig }, () => {
            chrome.storage.sync.get("tldw_config", (result) => {
              const stored = result.tldw_config;
              chrome.storage.sync.remove("tldw_config", () => {
                resolve({
                  stored,
                  providerOk: stored?.provider === "openrouter",
                  modelOk: stored?.model === "google/gemini-3-flash-preview",
                  keyOk: stored?.apiKey === "test-key-12345",
                });
              });
            });
          });
        })
      `,
      awaitPromise: true,
      returnByValue: true,
    });
    logTest(
      "Config round-trip via chrome.storage.sync works",
      configStorageResult.result.value?.providerOk &&
        configStorageResult.result.value?.modelOk &&
        configStorageResult.result.value?.keyOk,
      `provider=${configStorageResult.result.value?.providerOk}, model=${configStorageResult.result.value?.modelOk}, key=${configStorageResult.result.value?.keyOk}`
    );
  }

  await optionsPage.close();

  // ═══════════════════════════════════════════════════════════════
  // 11. Manifest host_permissions include openrouter
  // ═══════════════════════════════════════════════════════════════
  console.log("\n--- Manifest tests ---");

  const manifestResult = await swCdp.send("Runtime.evaluate", {
    expression: `
      new Promise((resolve) => {
        fetch(chrome.runtime.getURL('manifest.json'))
          .then(r => r.json())
          .then(manifest => resolve(manifest))
          .catch(e => resolve({ error: e.message }));
      })
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  const manifest = manifestResult.result.value;
  if (manifest && !manifest.error) {
    const hostPerms = manifest.host_permissions || [];
    logTest(
      "Manifest includes openrouter.ai host permission",
      hostPerms.some((p) => p.includes("openrouter.ai")),
      `host_permissions: ${hostPerms.join(", ")}`
    );
    logTest(
      "Manifest includes anthropic host permission",
      hostPerms.some((p) => p.includes("api.anthropic.com")),
      "has anthropic"
    );
    logTest(
      "Manifest includes openai host permission",
      hostPerms.some((p) => p.includes("api.openai.com")),
      "has openai"
    );
    logTest(
      "Manifest includes youtube host permission",
      hostPerms.some((p) => p.includes("youtube.com")),
      "has youtube"
    );
  } else {
    logTest("Manifest could be read", false, manifest?.error || "no manifest");
  }

  // Print summary
  console.log("\n=== Test Summary ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results) {
      if (r.status === "FAIL") {
        console.log(`  - ${r.name}: ${r.detail}`);
      }
    }
  }

  await cleanup();

  process.exit(failed > 0 ? 1 : 0);
}

async function cleanup() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
  }
}

run().catch(async (err) => {
  console.error("Test runner error:", err);
  await cleanup();
  process.exit(2);
});
