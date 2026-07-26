const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const expectedVersion = require(path.join(root, 'src', 'manifest.json')).version;
const screenshotPath = path.join(root, 'dogfood-output', 'screenshots', 'quick-replies-inserted.png');
const animationScreenshotPath = path.join(root, 'dogfood-output', 'screenshots', 'quick-reply-animation.png');
const settingsScreenshotPath = path.join(root, 'dogfood-output', 'screenshots', 'quick-replies-settings.png');
let browser;

(async () => {
    browser = await chromium.launch({
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });

    await context.addInitScript(({ expectedVersion }) => {
        const storage = {};
        const syncStorage = {};
        const listeners = [];
        window.__optionsOpened = 0;

        const makeStorageArea = values => ({
            get(keys, callback) {
                const result = {};
                const requestedKeys = Array.isArray(keys) ? keys : Object.keys(keys || {});
                for (const key of requestedKeys) {
                    if (Object.prototype.hasOwnProperty.call(values, key)) result[key] = values[key];
                }
                callback?.(result);
                return Promise.resolve(result);
            },
            set(nextValues, callback) {
                const changes = {};
                for (const [key, value] of Object.entries(nextValues)) {
                    changes[key] = { oldValue: values[key], newValue: value };
                    values[key] = structuredClone(value);
                }
                listeners.forEach(listener => listener(changes, values === syncStorage ? 'sync' : 'local'));
                callback?.();
                return Promise.resolve();
            },
            remove(keys, callback) {
                const requestedKeys = Array.isArray(keys) ? keys : [keys];
                const changes = {};
                for (const key of requestedKeys) {
                    changes[key] = { oldValue: values[key], newValue: undefined };
                    delete values[key];
                }
                listeners.forEach(listener => listener(changes, values === syncStorage ? 'sync' : 'local'));
                callback?.();
                return Promise.resolve();
            }
        });

        window.chrome = {
            runtime: {
                id: 'integration-test',
                openOptionsPage: async () => { window.__optionsOpened += 1; },
                getManifest: () => ({ version: expectedVersion }),
                sendMessage: async () => ({})
            },
            storage: {
                local: makeStorageArea(storage),
                sync: makeStorageArea(syncStorage),
                onChanged: {
                    addListener(listener) { listeners.push(listener); }
                }
            },
            tabs: {
                query(_query, callback) { callback([]); },
                sendMessage: async () => ({})
            }
        };
    }, { expectedVersion });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('https://127.0.0.1:8443/messages/123');
    await page.addStyleTag({ path: path.join(root, 'src', 'content', 'chat_ui.css') });
    await page.addScriptTag({ path: path.join(root, 'src', 'content', 'quick_reply_manager.js') });
    await page.addScriptTag({ path: path.join(root, 'src', 'content', 'quick_reply_ui.js') });

    const toolbar = page.locator('#etsy-ai-quick-replies');
    await toolbar.waitFor();
    assert.equal(await page.locator('.etsy-ai-quick-reply-chip').count(), 3);

    await page.getByRole('button', { name: 'Insert quick reply: Checking' }).click();
    assert.equal(
        await page.locator('textarea.wt-textarea').inputValue(),
        'Thank you for the message. I’ll check the details and get back to you shortly.'
    );
    assert.equal(await page.evaluate(() => window.mockSendCount), 0, 'insertion must not click Send');
    assert.equal(await page.locator('.etsy-ai-quick-reply-flyer').count(), 1, 'short flight animation appears');
    await page.screenshot({ path: animationScreenshotPath, fullPage: true });
    await page.waitForTimeout(520);
    assert.equal(await page.locator('.etsy-ai-quick-reply-flyer').count(), 0, 'flight animation cleans itself up');

    await page.evaluate(async () => {
        await window.QuickReplyManager.add('Custom', 'A manually saved custom reply.');
    });
    await page.getByRole('button', { name: 'Insert quick reply: Custom' }).waitFor();

    await page.getByRole('button', { name: 'Manage' }).click();
    assert.equal(await page.evaluate(() => window.__optionsOpened), 1);

    await page.screenshot({ path: screenshotPath, fullPage: true });
    assert.deepEqual(pageErrors, []);

    const settingsPage = await context.newPage();
    const settingsErrors = [];
    settingsPage.on('pageerror', error => settingsErrors.push(error.message));
    await settingsPage.goto(pathToFileURL(path.join(root, 'src', 'options', 'options.html')).href);
    await settingsPage.getByRole('heading', { name: /Quick Replies/ }).waitFor();
    await settingsPage.locator('#quickReplyList .memory-item').first().waitFor();
    assert.equal(await settingsPage.locator('#quickReplyList .memory-item').count(), 3);

    await settingsPage.getByRole('button', { name: 'Edit Thanks' }).click();
    await settingsPage.locator('#quickReplyLabelInput').fill('Warm thanks');
    await settingsPage.locator('#quickReplyTextInput').fill('Thank you so much for your message!');
    await settingsPage.getByRole('button', { name: 'Save quick reply' }).click();
    await settingsPage.getByText('Warm thanks', { exact: true }).waitFor();

    await settingsPage.locator('#quickReplyLabelInput').fill('Follow-up');
    await settingsPage.locator('#quickReplyTextInput').fill('Just following up on my previous message.');
    await settingsPage.getByRole('button', { name: 'Add quick reply' }).click();
    await settingsPage.getByText('Follow-up', { exact: true }).waitFor();
    assert.equal(await settingsPage.locator('#quickReplyList .memory-item').count(), 4);
    assert.equal(await settingsPage.locator('#extensionVersion').textContent(), expectedVersion);

    await settingsPage.screenshot({ path: settingsScreenshotPath, fullPage: true });
    assert.deepEqual(settingsErrors, []);
    await browser.close();
    browser = null;
    console.log('quick_reply_ui integration tests passed');
})().catch(error => {
    console.error(error);
    if (browser) browser.close().catch(() => { });
    process.exitCode = 1;
});
