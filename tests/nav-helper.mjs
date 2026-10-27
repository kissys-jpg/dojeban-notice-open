/* 기능 검증에서 실제 상위 메뉴와 하위 버튼을 따라 이동합니다. */
export async function nav(page,route){
 const parents={school:'schedule',anon:'notices',purchases:'projects',equipment:'projects',cert:'contest',portfolio:'company',intro:'company',photos:'materials',tools:'materials',register:'roster',training:'learner',attendance:'learner',ojtcalendar:'learner',units:'learner',board:'projects',team:'projects'};
 if(route==='intro'){await nav(page,'portfolio');await page.locator('[data-portfolio-view=intro]').click();return;}
 if(route==='tools'&&await page.locator('[data-projsub=tools]').count()){await page.locator('[data-projsub=tools]').first().click();return;}
 if(route==='me'){await page.locator('#profileTop').click();return;}
 const root=parents[route]||route;await page.locator('#tabs [data-tab="'+root+'"]').click();
 if(route!==root)await page.locator('[data-nav-route="'+route+'"]').click();
}
