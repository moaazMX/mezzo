import asyncio
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",         # Set the browser window size
                "--disable-dev-shm-usage",        # Avoid using /dev/shm which can cause issues in containers
                "--ipc=host",                     # Use host-level IPC for better stability
                "--single-process"                # Run the browser in a single process mode
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        context.set_default_timeout(5000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Interact with the page elements to simulate user flow
        # -> Navigate to http://localhost:5173
        await page.goto("http://localhost:5173")
        
        # -> Add an item to the cart by clicking an 'إضافة' button, then open the cart/checkout panel.
        frame = context.pages[-1]
        # Click element
        elem = frame.locator('xpath=/html/body/div/div/main/div/div/section/div/div/div/div[2]/div/button').nth(0)
        await asyncio.sleep(3); await elem.click()
        
        frame = context.pages[-1]
        # Click element
        elem = frame.locator('xpath=/html/body/div/div/header/div/div/div/div/button[2]').nth(0)
        await asyncio.sleep(3); await elem.click()
        
        # -> Open the checkout flow by clicking the 'إتمام الطلب' button in the cart panel, then wait for the checkout UI to settle so the coupon input can be located.
        frame = context.pages[-1]
        # Click element
        elem = frame.locator('xpath=/html/body/div/div/div[3]/div/div[3]/button').nth(0)
        await asyncio.sleep(3); await elem.click()
        
        # -> Fill the name and phone fields, click 'التالي' to continue to the next checkout step so the coupon input can be located and an invalid coupon can be applied.
        frame = context.pages[-1]
        # Input text
        elem = frame.locator('xpath=/html/body/div/div/div[3]/div/div[2]/div/div/div/div/div/form/div/div/input').nth(0)
        await asyncio.sleep(3); await elem.fill('اختبار المستخدم')
        
        frame = context.pages[-1]
        # Input text
        elem = frame.locator('xpath=/html/body/div/div/div[3]/div/div[2]/div/div/div/div/div/form/div/div[2]/input').nth(0)
        await asyncio.sleep(3); await elem.fill('0501234567')
        
        frame = context.pages[-1]
        # Click element
        elem = frame.locator('xpath=/html/body/div/div/div[3]/div/div[2]/div/div/div/div/div/form/div/div[3]/button').nth(0)
        await asyncio.sleep(3); await elem.click()
        
        # -> Click the 'التالي' (Next) button to proceed to the checkout step that includes the coupon input, then wait for the UI to settle so the coupon field can be located.
        frame = context.pages[-1]
        # Click element
        elem = frame.locator('xpath=/html/body/div/div/div[3]/div/div[2]/div/div/div/div/div/form/div/div[3]/button').nth(0)
        await asyncio.sleep(3); await elem.click()
        
        # -> Click the 'التالي' (Next) button to proceed to the checkout step that contains the coupon input, then wait for the UI to settle and locate the coupon field.
        frame = context.pages[-1]
        # Click element
        elem = frame.locator('xpath=/html/body/div/div/div[3]/div/div[2]/div/div/div/div/div/form/div/div[3]/button').nth(0)
        await asyncio.sleep(3); await elem.click()
        
        # --> Assertions to verify final state
        frame = context.pages[-1]
        assert await frame.locator("xpath=//*[contains(., 'الكوبون غير صالح أو منتهي الصلاحية')]").nth(0).is_visible(), "The coupon validation error الكوبون غير صالح أو منتهي الصلاحية should be visible after applying an invalid or expired coupon","assert await frame.locator("xpath=//*[contains(., 'التالي')]").nth(0).is_visible(), "The checkout should remain open showing the التالي button after attempting to apply an invalid or expired coupon"
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    