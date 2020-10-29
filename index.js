#!/usr/bin/env node
'use strict';
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');

const axios = require('axios');
const puppeteer = require('puppeteer');

// Command line
const optionDefinitions = [
		{ name: 'crm-ui-start', type: String, defaultValue: 'https://bs1web.sap.roche.com/sap/bc/bsp/sap/crm_ui_start/default.htm', description: "URL of crm_ui_start." },
		{ name: 'no-headless', type: Boolean, defaultValue: false, description: "Don't run headless - for testing." },
		{ name: 'help', alias: 'h', type: Boolean, description: "Print this usage guide." },
		{ name: 'slowmo', type: Number, defaultValue: 0, description: "Slow execution down - for testing, e.g. 250, default 0." },
		{ name: 'transport-request', alias: 't', type: String, description: "Transport request, e.g. 'C0000000000000004037'." },
		//{ name: 'verbose', alias: 'v', type: Boolean, description: "Be verbose on the console." }
		{ name: 'work-item-guid', alias: 'w', type: String, description: "Optional work item GUID, with or without dashes, e.g. '005056BD-A0FF-1EDB-83F6-92FDA092DD16'." },
		{ name: 'work-item-number', alias: 'n', type: String, description: "Work item number, e.g. '3200002672', to match against the work item opened, and the description of the TMS transport request." }
];

const optionUsage = commandLineUsage([
		{ header: "assign-transport-request", content: "Assign transport request to work item." },
		{ header: "Synopsis", content: [
				"$ assign-transport-request -t C0000000000000004037 -w 005056BD-A0FF-1EDB-83F6-92FDA092DD16 -n 3200002672",
				'$ assign-transport-request --help']},
		{ header: 'Options', optionList: optionDefinitions },
		{ header: 'Environment Variables', content: [
				{name: 'PAGEUSER',		desc: 'User name for the Solution Manager (SolMan) connection.'},
				{name: 'PAGEPASSWORD',	desc: 'Password for the SolMan connection.'}]
		}
]);

async function logoffBrowserClose(browser, page) {

		await page.evaluate(() => {
				crmuifClient.winMan.closeAll();
				crmuifClient.logOff();
		});
		console.error(`Info: logged off`);

		await browser.close();
		console.error(`Info: closed browser`);
}

async function assignTransportRequest(options) {
		// Env
		const pageUser = process.env.PAGEUSER;
		const pagePwd = process.env.PAGEPASSWORD;

		const encUserPwd = Buffer.from(`${pageUser}:${pagePwd}`).toString('base64');

		// Do we have a work item GUID?
		let workItemGuid = options['work-item-guid'];
		if(!workItemGuid) {
				const matches = options['crm-ui-start'].match('^https://[^/]+');
				if(!Array.isArray(matches)) {

						console.error(`Error: can't find base url in ${options['crm-ui-start']} for OData call`);
						return 1;
				}
				const odataUrl = `${matches[0]}/sap/opu/odata/salm/CRM_GENERIC_SRV/WORKSPACESET?sap-language=EN&$filter=(ProcessType%20eq%20%27S1MJ%27%20and%20ObjectId%20eq%20%27${options['work-item-number']}%27)&$select=Guid,ObjectId&$format=json`;
				let response;
				try {
						response = await axios.get(odataUrl,{ headers: { 'Authorization': `Basic ${encUserPwd}` } });
				} catch(err) {
						console.error(err);
						return 1;
				}
				debugger;
				workItemGuid = response.data.d.results[0].Guid;
				console.error(`Info: GUID for ${options['work-item-number']} is ${workItemGuid}`);
		}
		workItemGuid = workItemGuid.replace(/-/g, '').toUpperCase();
		if(!workItemGuid) {
			console.error(`Error: work item GUID is unknown`);
			return 1;
		}
		return 1;

		console.error(`Info: opening work item ${workItemGuid}`);

		const browser = await puppeteer.launch({
				//args: ['--no-sandbox', '--disable-setuid-sandbox'],
				defaultViewport: {
						width: 1280,
						height: 768
				},
				headless: !options['no-headless'],
				slowMo: options['slowmo'],            // slow down
				//devtools: true,
				ignoreHTTPSErrors: true
		});

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
				await logoffBrowserClose(browser, page);
				return 1;
		}

		//debugger;					// chrome://inspect/#devices
		await frame.waitForSelector("[id='C13_W39_V41_EDIT']");
		await frame.click("[id='C13_W39_V41_EDIT']");
		try {
				await frame.waitForSelector("[id='C13_W39_V41_EDIT'].th-bt-icontext-dis", {timeout: 5000});
		} catch(err) {
				// "Transaction 3200000665 is being processed by user KAJANL"
				const message = await frame.evaluate(() => {
						return document.querySelectorAll("[id='CRMMessageLine1'] span")[2].textContent;
				});

				if(/^Transaction.*is being processed by user/.test(message)) {

						console.error(`Error: ${message}`);
						await logoffBrowserClose(browser, page);
						return 2; // WI is locked
				} else {
						throw err;
				}
		}

		console.error('Info: editing work item');

		try {
				const btnTransportManagement = await frame.waitForXPath("//td[text()='Transport Management']");
				await btnTransportManagement.click();
				const btnMore = await frame.waitForXPath("//div[@id='thtmlbOverviewPageBox']//b[text()='More']");
				await btnMore.click();

				console.error(`Info: waiting for 'Assign Transport Request'`);

				let btnAssignTransReq;
				try {
						btnAssignTransReq = await frame.waitForXPath("//span[text()='Assign Transport Request']");
				}
				catch (err) {
						// Very rarely we get a timeout for the above. Let's take a screen shot to see what happened:
						await page.screenshot({path: './waitingForAssignTransportRequest.png'});
						throw err;
				}

				// Must be done on the 3rd ascendent <a>
				await btnAssignTransReq.evaluate(node => {
						eMu = new window.MouseEvent("mouseup");
						node.parentElement.parentElement.parentElement.dispatchEvent(eMu);
				});
				await frame.waitForSelector("[id='submitInProgress']");
				//"https://bs1web.sap.roche.com/sap(====)/bc/bsp/sap/bsp_wd_base/popup_buffered_frame_cached.htm?sap-client=010&sap-language=EN&sap-domainRelax=min"
				const popupWindowTarget = await browser.waitForTarget(target => /bsp_wd_base\/popup_buffered_frame_cached/.test(target.url()));

				const popupPage = await popupWindowTarget.page();
				const popupFrames = await popupPage.frames();
				const popupFrame = popupFrames.find(f => f.name() === 'WorkAreaFrame1popup');

				if(popupFrame === undefined) { throw new Error("could not find popup frame 'WorkAreaFrame1popup'"); }
				console.error(`Info: opened popup`);

				try {
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

						console.error(`Info: searching for transport request`);

						await popupFrame.waitForSelector("[id='C25_W87_V88_V90_TABLE_sel_1-rowsel']");

						// Does the transport description match this work item?
						await popupFrame.waitForSelector("[id='C25_W87_V88_V90_searchresultnode_table[1].text']");
						const trText = await popupFrame.evaluate(() => { return document.getElementById("C25_W87_V88_V90_searchresultnode_table[1].text").textContent; });

						// WI: 3200002672, commit: 4a50f4c42595d9c778f0631351bf4d31bad1
						const trTextMatch = trText.match(/\bWI: (\d{10})/);
						if(!Array.isArray(trTextMatch) || trTextMatch[1] !== options['work-item-number']) {

								const message = `work item number of given transport does not match requested work item number: ${trTextMatch[1]} !== ${options['work-item-number']}`;
								console.error(`Error: ${message}`);

								throw new Error(message);
						}

						await popupFrame.click("[id='C25_W87_V88_V90_TABLE_sel_1-rowsel']");

						await popupFrame.waitForSelector("[id='C25_W87_V88_V90_TABLE__1__1'].th-clr-row-sel");
						await popupFrame.click("[id='C25_W87_V88_V90_ASSIGNTRA']");
						await frame.waitForSelector("[id='submitInProgress']", {hidden: true});

						console.error(`Info: assigned transport request to work item`);

				} catch (err){
						// Close the popup, the re-throw the error, which should result in cancelling any changes
						debugger;

						console.error(`Info: error occurred on popup, closing popup`);
						await popupPage.close({runBeforeUnload: true});
						await frame.waitForSelector("[id='submitInProgress']", {hidden: true});
						console.error(`Info: error occurred on popup, popup is now closed`);
						throw err;
				}
		} catch (err) {
				debugger;
				console.error(err);

				// Cancel changes
				console.error(`Info: error occurred while editing, cancelling`);
				await frame.waitForSelector("[id='C13_W39_V41_#Exit#_CANCEL']");
				await frame.click("[id='C13_W39_V41_#Exit#_CANCEL']");
				await frame.waitForSelector("[id='submitInProgress']", {hidden: true});
				await frame.waitForSelector("[id='C13_W39_V41_#Exit#_CANCEL'].th-bt-icontext-dis");
				console.error(`Info: error occurred while editing, cancelled`);

				await logoffBrowserClose(browser, page);
				return 1;
		}

		await frame.click("[id='C13_W39_V41_SAVE']");
		await frame.waitForSelector("[id='submitInProgress']", {hidden: true});
		await frame.waitForSelector("[id='CRMMessageLine1']");
		await frame.waitForFunction(() => {
				return /^Transaction.*saved$/.test(document.querySelectorAll("[id='CRMMessageLine1'] span")[2].textContent);
		}, {polling: 333});

		console.error(`Info: saved work item`);

		await frame.click("[id='C13_W39_V41_DISPLAY']");
		await frame.waitForSelector("[id='C13_W39_V41_DISPLAY'].th-bt-text-dis");

		console.error(`Info: switched to 'Display'`);

		await logoffBrowserClose(browser, page);
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

						console.error("Error: 'crm-ui-start' is not given, use --crm-ui-start option.");
						printHelp = true;
				} else if (!options["transport-request"]) {

						console.error("Error: 'transport-request' is not given, use --transport-request option.");
						printHelp = true;
				} else if (!options["work-item-guid"]) {

						console.log("Info: 'work-item-guid' is not given, it will be deduced from the work item number.");
				} else if (!options["work-item-number"]) {

						console.error("Error: 'work-item-number' is not given, use --work-item-number option.");
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
