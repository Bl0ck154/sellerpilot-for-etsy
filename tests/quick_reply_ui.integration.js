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
        window.__backgroundOptionsRequests = 0;
        window.__directOptionsOpened = 0;

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
                openOptionsPage: async () => { window.__directOptionsOpened += 1; },
                getManifest: () => ({ version: expectedVersion }),
                sendMessage: async message => {
                    if (message?.type === 'OPEN_OPTIONS_PAGE') {
                        window.__backgroundOptionsRequests += 1;
                        window.__optionsOpened += 1;
                        return { success: true };
                    }
                    return {};
                }
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
    assert.equal(await page.locator('.etsy-ai-quick-replies-status').count(), 0, 'no inserted/review toast is rendered');
    assert.equal(await page.locator('.etsy-ai-quick-reply-flyer').count(), 1, 'short flight animation appears');
    await page.screenshot({ path: animationScreenshotPath, fullPage: true });
    await page.waitForTimeout(520);
    assert.equal(await page.locator('.etsy-ai-quick-reply-flyer').count(), 0, 'flight animation cleans itself up');

    await page.evaluate(async () => {
        await window.QuickReplyManager.add('Custom', 'A manually saved custom reply.');
    });
    await page.getByRole('button', { name: 'Insert quick reply: Custom' }).waitFor();

    const layoutBeforeOverflow = await toolbar.evaluate(element => {
        const chip = element.querySelector('.etsy-ai-quick-reply-chip');
        const toolbarRect = element.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            toolbarTop: toolbarRect.top,
            toolbarHeight: toolbarRect.height,
            chipTop: chipRect.top,
            backgroundColor: style.backgroundColor,
            borderTopWidth: style.borderTopWidth,
            previousToComposer: element.nextElementSibling?.classList.contains('inline-compose-container')
        };
    });
    assert.equal(layoutBeforeOverflow.previousToComposer, true, 'toolbar sits outside and immediately above the focused composer');
    assert.equal(layoutBeforeOverflow.backgroundColor, 'rgba(0, 0, 0, 0)', 'toolbar background is transparent');
    assert.equal(layoutBeforeOverflow.borderTopWidth, '0px', 'toolbar has no visible frame');

    await page.evaluate(async () => {
        for (let index = 1; index <= 24; index++) {
            await window.QuickReplyManager.add(
                `Overflow template ${index}`,
                `Long overflow reply body ${index}. This remains an unsent draft.`
            );
        }
    });
    await page.waitForFunction(() => document.querySelectorAll('.etsy-ai-quick-reply-chip').length === 28);

    const overflowLayout = await toolbar.evaluate(element => {
        const chips = element.querySelector('.etsy-ai-quick-replies-chips');
        const chip = element.querySelector('.etsy-ai-quick-reply-chip');
        const toolbarRect = element.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        const chipsStyle = getComputedStyle(chips);
        return {
            toolbarTop: toolbarRect.top,
            toolbarHeight: toolbarRect.height,
            chipTop: chipRect.top,
            hasHorizontalOverflow: chips.scrollWidth > chips.clientWidth,
            overflowY: chipsStyle.overflowY,
            scrollbarWidth: chipsStyle.scrollbarWidth
        };
    });
    assert.equal(overflowLayout.hasHorizontalOverflow, true, 'many replies remain in a horizontally scrollable rail');
    assert.equal(overflowLayout.overflowY, 'hidden', 'the rail cannot grow or jump vertically');
    assert.equal(overflowLayout.scrollbarWidth, 'none', 'the scrollbar does not change chip alignment');
    assert.ok(Math.abs(overflowLayout.toolbarTop - layoutBeforeOverflow.toolbarTop) <= 1, 'toolbar top stays stable');
    assert.ok(Math.abs(overflowLayout.toolbarHeight - layoutBeforeOverflow.toolbarHeight) <= 1, 'toolbar height stays stable');
    assert.ok(Math.abs(overflowLayout.chipTop - layoutBeforeOverflow.chipTop) <= 1, 'chips do not jump when overflow appears');

    await page.locator('.etsy-ai-quick-replies-chips').dispatchEvent('wheel', { deltaY: 120 });
    await page.waitForFunction(() => document.querySelector('.etsy-ai-quick-replies-chips').scrollLeft > 0);
    await page.locator('.etsy-ai-quick-replies-chips').evaluate(element => { element.scrollLeft = 0; });

    await page.getByRole('button', { name: 'Manage' }).click();
    assert.equal(await page.evaluate(() => window.__optionsOpened), 1);
    assert.equal(await page.evaluate(() => window.__backgroundOptionsRequests), 1, 'Manage uses the background service worker');
    assert.equal(await page.evaluate(() => window.__directOptionsOpened), 0, 'direct fallback is not used on success');

    await page.evaluate(() => {
        window.chrome.runtime.sendMessage = async () => { throw new Error('background unavailable'); };
    });
    await page.getByRole('button', { name: 'Manage' }).click();
    assert.equal(await page.evaluate(() => window.__directOptionsOpened), 1, 'Manage falls back to direct options opening');

    await page.evaluate(() => {
        document.querySelector('.etsy-ai-quick-replies-chips').scrollLeft = 0;
        document.querySelector('textarea.wt-textarea').scrollLeft = 0;
    });

    await page.screenshot({ path: screenshotPath, fullPage: true });
    assert.deepEqual(pageErrors, []);

    const settingsPage = await context.newPage();
    const settingsErrors = [];
    settingsPage.on('pageerror', error => settingsErrors.push(error.message));
    await settingsPage.goto(`${pathToFileURL(path.join(root, 'src', 'options', 'options.html')).href}#quick-replies`);
    await settingsPage.getByRole('heading', { name: /Quick Replies/ }).waitFor();
    await settingsPage.waitForFunction(() => document.activeElement?.id === 'quick-replies');
    assert.equal(await settingsPage.locator('.settings-disclosure').evaluate(element => element.open), false, 'API keys are collapsed by default');
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

    await settingsPage.evaluate(async () => {
        for (let index = 1; index <= 24; index++) {
            await window.QuickReplyManager.add(`Managed reply ${index}`, `Managed reply body ${index}.`);
        }
    });
    await settingsPage.waitForFunction(() => document.querySelectorAll('#quickReplyList .memory-item').length === 28);
    const managedListOverflow = await settingsPage.locator('#quickReplyList').evaluate(element => ({
        hasVerticalOverflow: element.scrollHeight > element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        maxHeight: getComputedStyle(element).maxHeight
    }));
    assert.equal(managedListOverflow.hasVerticalOverflow, true, 'manual management remains bounded with many replies');
    assert.equal(managedListOverflow.overflowY, 'auto');
    assert.equal(managedListOverflow.maxHeight, '320px');

    await settingsPage.waitForTimeout(2100);
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
