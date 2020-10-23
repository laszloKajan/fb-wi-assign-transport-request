#!/usr/bin/env node
'use strict';
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');

const puppeteer = require('puppeteer');

// Command line
const optionDefinitions = [
		{ name: 'crm-ui-start', type: String, defaultValue: 'https://bs1web.sap.roche.com/sap/bc/bsp/sap/crm_ui_start/default.htm', description: "URL of crm_ui_start." },
		{ name: 'not-headless', type: Boolean, defaultValue: false, description: "Don't run headless - for testing." },
		{ name: 'help', alias: 'h', type: Boolean, description: "Print this usage guide." },
		{ name: 'slowmo', type: Number, defaultValue: 0, description: "Slow execution down - for testing, e.g. 250, default 0." },
		{ name: 'transport-request', alias: 't', type: String, description: "Transport request, e.g. 'C0000000000000004037'." },
		//{ name: 'verbose', alias: 'v', type: Boolean, description: "Be verbose on the console." }
		{ name: 'work-item-guid', alias: 'w', type: String, description: "Work item GUID, with or without dashes, e.g. '005056BD-A0FF-1EDB-83F6-92FDA092DD16'." },
		{ name: 'work-item-number', alias: 'n', type: String, description: "Work item number, e.g. '3200002672', to match against the work item opened, and the description of the TMS transport request." }
];

const optionUsage = commandLineUsage([
		{ header: "assign-transport-request", content: "Assign transport request to work item." },
		{
				header: "Synopsis", content: [
						"$ assign-transport-request -t C0000000000000004037 -w 005056BD-A0FF-1EDB-83F6-92FDA092DD16",
						'$ assign-transport-request --help'
				],
		},
		{ header: 'Options', optionList: optionDefinitions }]);

async function assignTransportRequest(options) {
		// Env
		const pageUser = process.env.PAGEUSER;
		const pagePwd = process.env.PAGEPASSWORD;

		const workItemGuid = options['work-item-guid'].replace(/-/g, '').toUpperCase();

		console.error(`Info: opening work item ${workItemGuid}`);

		const browser = await puppeteer.launch({
				//args: ['--no-sandbox', '--disable-setuid-sandbox'],
				defaultViewport: {
						width: 1024,
						height: 768
				},
				headless: !options['not-headless'],
				slowMo: options['slowmo'],            // slow down
				//devtools: true,
				ignoreHTTPSErrors: true
		});

		const encUserPwd = Buffer.from(`${pageUser}:${pagePwd}`).toString('base64');

		let pages = await browser.pages();
		let page;
		if(pages.length >= 1) {page = pages[0];} else {page = await browser.newPage();}
		//console.log(`${pageUser}:${pagePwd}`);
		await page.authenticate({'username': pageUser, 'password': pagePwd});
		await page.setExtraHTTPHeaders({
				'Authorization': `Basic ${encUserPwd}`
		});
		await page.goto(`${options['crm-ui-start']}?saml2=disabled&CRM-OBJECT-TYPE=AIC_OB_CMNC&CRM-OBJECT-ACTION=B&CRM-OBJECT-VALUE=${workItemGuid}&saprole=%2fSALM%2fDEVEL`,
				{timeout: 120000, waitUntil: 'load'}
		);

		// https://github.com/puppeteer/puppeteer / Debugging tips
		//await page.evaluate(() => {debugger;});
		const frames = await page.frames();
		const frame = frames.find(f => f.name() === 'WorkAreaFrame1'); // name or id for the frame
		//const CRMApplicationFrame = frames.find(f => f.name() === 'CRMApplicationFrame'); // name or id for the frame
		//const frames = await CRMApplicationFrame.frames();
		//const frame = frames.find(f => f.name() === 'WorkAreaFrame1'); // name or id for the frame

		// Is this the WI in options['work-item-number']?
		await frame.waitForSelector("[id='bcTitle'] div");
		const bcTitle = await frame.evaluate(() => { return document.querySelector("[id='bcTitle'] div").textContent; });

		// Work Item (NC): 3200000665, 010 Hello ASPIRE
		const bcTitleMatch = bcTitle.match(/^Work Item \(NC\): (\d{10})/);
		if(!Array.isArray(bcTitleMatch) || bcTitleMatch[1] !== options['work-item-number']) {

				console.error(`Error: work item number of given GUID does not match requested work item number: ${bcTitleMatch[1]} !== ${options['work-item-number']}`);
				await browser.close();
				return 1;
		}

		//debugger;					// chrome://inspect/#devices
		await frame.waitForSelector("[id='C13_W39_V41_EDIT']");
		await frame.click("[id='C13_W39_V41_EDIT']");
		try {
				await frame.waitForSelector("[id='C13_W39_V41_EDIT'].th-bt-icontext-dis", {timeout: 5000});
		} catch(err) {
				// "Transaction 3200000665 is being processed by user KAJANL"?
				const message = await frame.evaluate(() => {
						return document.querySelectorAll("[id='CRMMessageLine1'] span")[2].textContent;
				});

				if(/^Transaction.*is being processed by user/.test(message)) {

						console.error(`Error: ${message}`);
						await browser.close();
						return 2; // WI is locked
				} else {
						throw err;
				}
		}

		console.error(`Info: editing work item`);

		await frame.click("[id='0007_nl5_5_C13_W39_V41_mid']");
		await frame.waitForSelector("[id='C24_W82_V83_V84_thtmlb_menuButton_1']");
		await frame.waitForSelector("[id='submitInProgress']", {hidden: true});
		await frame.click("[id='C24_W82_V83_V84_thtmlb_menuButton_1']");

		await frame.waitForSelector("[id='C24_W82_V83_V84_thtmlb_menuButton_1__items____AssignTransReq']");
		await frame.evaluate(() => {
				eMu = new window.MouseEvent("mouseup");
				document.getElementById("C24_W82_V83_V84_thtmlb_menuButton_1__items____AssignTransReq").dispatchEvent(eMu);
		});
		await frame.waitForSelector("[id='submitInProgress']");
		//"https://bs1web.sap.roche.com/sap(====)/bc/bsp/sap/bsp_wd_base/popup_buffered_frame_cached.htm?sap-client=010&sap-language=EN&sap-domainRelax=min"
		const popupWindowTarget = await browser.waitForTarget(target => /bsp_wd_base\/popup_buffered_frame_cached/.test(target.url()));

		const popupPage = await popupWindowTarget.page();
		const popupFrames = await popupPage.frames();
		const popupFrame = popupFrames.find(f => f.name() === 'WorkAreaFrame1popup');

		console.error(`Info: opened popup`);

		await popupFrame.waitForSelector("[id='C25_W87_V88_V89_searchquerynode_parameters[2].OPERATOR-btn']");
		await popupFrame.click("[id='C25_W87_V88_V89_searchquerynode_parameters[2].OPERATOR-btn']");

		await popupFrame.waitForSelector("[id='C25_W87_V88_V89_searchquerynode_parameters[2].OPERATOR__items']");
		await popupFrame.evaluate(() => {
				document.getElementById("C25_W87_V88_V89_searchquerynode_parameters[2].OPERATOR__items").querySelector("a[key='CP']").click();
		});
		// C.f. frame.type()
		//debugger;
		//await popupFrame.type("[id='C25_W87_V88_V89_searchquerynode_parameters[2].VALUE1']", options['transport-request']);
		// kajanl: Attention: /soon/ after clicking the CP item, its value is cleared. I found no good way to tell when this is, hence the (shameful) waitForTimeout().
		// 	.type() is not much better: it's sensitive to mouse moves, when it is not run headless.
		await popupFrame.waitForTimeout(500);
		await popupFrame.evaluate((transportRequest) => {
				document.getElementById("C25_W87_V88_V89_searchquerynode_parameters[2].VALUE1").value = transportRequest;
		}, options['transport-request']);
		await popupFrame.click("[id='C25_W87_V88_V89_SEARCH_BTN']");
		await popupFrame.waitForSelector("[id='C25_W87_V88_V90_TABLE_sel_1-rowsel']");
		await popupFrame.click("[id='C25_W87_V88_V90_TABLE_sel_1-rowsel']");

		await popupFrame.waitForSelector("[id='C25_W87_V88_V90_TABLE__1__1'].th-clr-row-sel");
		await popupFrame.click("[id='C25_W87_V88_V90_ASSIGNTRA']");
		await frame.waitForSelector("[id='submitInProgress']", {hidden: true});

		console.error(`Info: assigned transport request to work item`);

		await frame.click("[id='C13_W39_V41_SAVE']");
		await frame.waitForSelector("[id='submitInProgress']", {hidden: true});
		await frame.waitForSelector("[id='CRMMessageLine1']");
		await frame.waitForFunction(() => {
				return /^Transaction.*saved$/.test(document.querySelectorAll("[id='CRMMessageLine1'] span")[2].textContent);
		}, {polling: 333});

		console.error(`Info: saved work item`);

		//await frame.click("[id='C13_W39_V41_#Exit#_CANCEL']");
		await frame.click("[id='C13_W39_V41_DISPLAY']");
		await frame.waitForSelector("[id='C13_W39_V41_DISPLAY'].th-bt-text-dis");

		console.error(`Info: switched to 'Display'`);

		await browser.close();

		console.error(`Info: closed browser`);

		return 0;
}

(async () => {
		let retCode = 0;

		// Command line
		const options = commandLineArgs(optionDefinitions);
		let printHelp = false;

		// Sanity
		if (options.help) {
				printHelp = true;
		} else {
				if (!options['crm-ui-start']) {

						console.log("Error: 'crm-ui-start' is not given, use --crm-ui-start option.");
						printHelp = true;
				} else if (!options["transport-request"]) {

						console.log("Error: 'transport-request' is not given, use --transport-request option.");
						printHelp = true;
				} else if (!options["work-item-guid"]) {

						console.log("Error: 'work-item-guid' is not given, use --work-item-guid option.");
						printHelp = true;
				} else if (!options["work-item-number"]) {

						console.log("Error: 'work-item-number' is not given, use --work-item-number option.");
						printHelp = true;
				}
		}
		//
		if (printHelp) {

				console.log(optionUsage);
				if (!options.help) { retCode = 1; }
		} else {

				retCode = await assignTransportRequest(options);
		}
		process.exitCode = retCode;
		return retCode;
})();

// vim:noet:ts=4:
