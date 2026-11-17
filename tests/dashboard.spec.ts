import {test, expect} from '@playwright/test';
import {readFileSync, readdirSync} from 'node:fs';

test('single file has no runtime asset dependencies', async ({page}) => {
  expect(readdirSync('dist')).toEqual(['index.html']);
  const html = readFileSync('dist/index.html','utf8');
  expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+rel="stylesheet"/);
  await page.goto('/');
  await expect(page.locator('#ov-stats')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-style','liquid');
});

for (const blocked of [false,true]) test(`styles, mode and mobile picker; storage blocked=${blocked}`, async ({page}) => {
  await page.setViewportSize({width:320,height:480});
  if(blocked) await page.addInitScript(()=>{ Storage.prototype.setItem=()=>{throw Error('blocked')}; });
  await page.goto('/');
  await page.locator('#btn-style').click();
  for(const style of ['bento','liquid','brutal','classic','shadcn']) {
    await page.locator(`[data-style-pick="${style}"]`).click();
    expect(await page.locator('html').getAttribute('data-style')).toBe(style==='classic'?null:style);
    await expect(page.locator(`[data-style-pick="${style}"]`)).toHaveAttribute('aria-pressed','true');
  }
  for (const mode of ['dark','light']) {
    await page.locator(`[data-mode-pick="${mode}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme',mode);
  }
  const rect=await page.locator('.pop').boundingBox();
  expect(rect!.y+rect!.height).toBeLessThanOrEqual(480-7);
  await page.locator('[data-mode-pick="auto"]').click();
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.locator('[data-style-pick="bento"]').click();
  await page.locator('#btn-style').click();
  await expect(page.locator('.pop')).toHaveCount(0);
  await page.locator('#btn-style').click();
  await expect(page.locator('.pop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pop')).toHaveCount(0);
  if(!blocked) {await page.reload();await expect(page.locator('html')).toHaveAttribute('data-style','bento');}
});

test('forward bulk add/edit/remove and conflict retain server rules, without credentials', async ({page}) => {
  let entries:any[]=[]; let revision='r0'; let writes:any[]=[]; let conflict=false;
  await page.route('**:9198/api/force-forward',async route=>{
    expect(route.request().headers().authorization).toBeUndefined();
    if(route.request().method()==='PUT') {
      const body=route.request().postDataJSON(); writes.push(body);
      if(conflict) return route.fulfill({status:409,json:{message:'版本已变化，请刷新后重试'}});
      expect(body.revision).toBe(revision);
      entries=body.entries.map((e:any,i:number)=>({...e,id:e.id||String(i+1)}));revision+='x';
    }
    await route.fulfill({json:{entries,revision,groups:['测试代理组'],job:{status:'succeeded'}}});
  });
  await page.goto('/#/force-forward');
  await expect(page.locator('#fp-add')).toBeEnabled();
  await page.locator('#fp-input').fill('Example.COM.\nexample.com\n测试.example');
  await page.locator('#fp-kind').selectOption('DOMAIN-SUFFIX');
  await page.locator('#fp-add').click();
  await expect(page.locator('#fp-count')).toHaveText('· 2');
  expect(writes[0].entries.map((e:any)=>e.value)).toEqual(['example.com','xn--0zwm56d.example']);
  await page.locator('[data-edit="1"]').click();
  await page.locator('#fp-mode').selectOption('direct');
  await page.locator('#fp-add').click();
  await expect.poll(()=>entries.find(e=>e.id==='1')?.policy).toBe('DIRECT');
  await expect(page.locator('#fp-add')).toBeEnabled();
  await page.locator('[data-remove="1"]').click();
  await page.locator('[data-v="1"]').click();
  await expect(page.locator('#fp-count')).toHaveText('· 1');
  await expect(page.locator('#fp-add')).toBeEnabled();
  await page.locator('#fp-input').fill('https://invalid.example');
  await page.locator('#fp-add').click();
  await expect(page.locator('#fp-error')).toContainText('纯域名');
  expect(writes).toHaveLength(3);
  conflict=true;
  await page.locator('#fp-input').fill('conflict.example');
  await page.locator('#fp-add').click();
  await expect(page.locator('#fp-error')).toContainText('版本已变化');
  await expect(page.locator('#fp-count')).toHaveText('· 1');
  await page.locator('#fp-search').fill('not-found');
  await expect(page.locator('#fp-list')).toContainText('没有匹配');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('missing helper disables writes and route cleanup aborts fetch',async({page})=>{
  let attempts=0;
  await page.route('**:9198/api/force-forward',async route=>{attempts++;await route.abort('connectionrefused')});
  await page.goto('/#/force-forward');
  await expect(page.locator('#fp-status')).toContainText('无法读取');
  await expect(page.locator('#fp-add')).toBeDisabled();
  await page.evaluate(()=>location.hash='/overview');
  await expect(page.locator('#ov-stats')).toBeVisible();
  await page.waitForTimeout(10500);
  expect(attempts).toBe(1);
});

test('helper output is escaped and running/failed jobs remain visible',async({page})=>{
  let status='running';
  await page.route('**:9198/api/force-forward',route=>route.fulfill({json:{entries:[{id:'1',value:'<img src=x onerror="window.xss=1">',rule_type:'DOMAIN',policy:'DIRECT'}],groups:[],revision:'r',job:{status,phase:status==='running'?'正在应用':'回滚失败',message:'测试错误'}}}));
  await page.goto('/#/force-forward');
  await expect(page.locator('#fp-status')).toContainText('正在应用');
  await expect(page.locator('#fp-add')).toBeDisabled();
  expect(await page.evaluate(()=>Object.hasOwn(window,'xss'))).toBe(false);
  status='failed';
  await expect(page.locator('#fp-status')).toContainText('测试错误',{timeout:5000});
  await page.locator('[data-remove="1"]').click();
  await expect(page.locator('.modal img')).toHaveCount(0);
  await expect(page.locator('.modal')).toContainText('<img');
});
