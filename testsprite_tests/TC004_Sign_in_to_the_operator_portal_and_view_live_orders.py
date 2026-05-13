import asyncio
import re
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        pw = await async_api.async_playwright().start()
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )
        context = await browser.new_context()
        context.set_default_timeout(15000)
        page = await context.new_page()
        # -> navigate
        await page.goto("http://localhost:5173")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill the operator password into the password field and submit the form (click 'دخول'), then verify the dashboard and live orders are displayed.
        # password input placeholder="أدخل كلمة المرور"
        elem = page.locator("xpath=/html/body/div/div/div/div/form/div/div/input").nth(0)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("moaazMXpl011#")
        
        # -> Fill the operator password into the password field and submit the form (click 'دخول'), then verify the dashboard and live orders are displayed.
        # button "إلغاء"
        elem = page.locator("xpath=/html/body/div/div/div/div/form/div[2]/button").nth(0)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.click()
        
        # -> Navigate to http://localhost:5173/operator and wait for the UI to render so the operator login modal can be interacted with.
        await page.goto("http://localhost:5173/operator")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Enter the operator password into the password field (index 263) and submit the form (press Enter) so the operator dashboard and live orders can be displayed and verified.
        # password input placeholder="أدخل كلمة المرور"
        elem = page.locator("xpath=/html/body/div/div/div/div/form/div/div/input").nth(0)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("moaazMXpl011#")
        
        # -> Open the operator login page (/operator) so the operator password field and submit button are visible, then proceed to login.
        await page.goto("http://localhost:5173/operator")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Click the 'الطلبات الحالية' (Current Orders) button to load/verify live orders are displayed.
        # button "الطلبات الحالية (
0
)"
        elem = page.locator("xpath=/html/body/div/div/div/div[2]/div/div[2]/div/button").nth(0)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.click()
        
        await asyncio.sleep(5)
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    