import {test, expect} from '@playwright/test';

test('mobile menu stays above its mask and accepts touch in every style',async({page})=>{
  await page.setViewportSize({width:393,height:660});
  await page.goto('/');
  for (const style of ['liquid','shadcn','bento','brutal','classic']) {
    await page.locator('#btn-style').click();
    await page.locator(`[data-style-pick="${style}"]`).click();
    await page.locator('#btn-style').click();
    for (const route of ['queries','force-forward','overview']) {
      await page.locator('#menu').click();
      const link=page.locator(`#side a[data-path="${route}"]`);
      await expect(link).toBeVisible();
      // A real click must hit the link; JS .click() would hide a mask stacking bug.
      await link.click({timeout:3000});
      await expect(page).toHaveURL(new RegExp(`#/${route}$`));
      await expect(page.locator('#side')).not.toHaveClass(/open/);
    }
    await page.locator('#menu').click();
    await page.locator('#side-mask').click({position:{x:380,y:300}});
    await expect(page.locator('#side')).not.toHaveClass(/open/);
  }
});
