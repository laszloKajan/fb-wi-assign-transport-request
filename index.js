#!/usr/bin/env node
'use strict';
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');

const axios = require('axios');
const fs = require('fs');
const https = require('https');
// kajanl:
//	https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-on-alpine
// 	puppeteer@chrome-86 (5.3.1) to match chromium=86.0.4240.111-r0 of Docker image node:12-alpine3.12
// 	Build Docker image with
// 		ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
//			PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
const puppeteer = require('puppeteer');
const sprintf = require('sprintf-js').sprintf;

// Command line
const optionDefinitions = [
		// https://***.com:443/sap/bc/ags_workcenter/ags_crm_docln?objectid=3200000665&proctype=S1MJ&saml2=disabled&saprole=%2fSALM%2fDEVEL
		{ name: 'no-headless', type: Boolean, defaultValue: false, description: "Don't run headless - for testing." },
		{ name: 'help', alias: 'h', type: Boolean, description: "Print this usage guide." },
		{ name: 'slowmo', type: Number, defaultValue: 0, description: "Slow execution down - for testing, e.g. 250, default 0." },
		{ name: 'solman-host', type: String, defaultValue: 'bs1web.sap.roche.com', description: "Solution Manager host." },
		{ name: 'transport-request', alias: 't', type: String, description: "Transport request, e.g. 'C0000000000000004037' or '4037'." },
		//{ name: 'verbose', alias: 'v', type: Boolean, description: "Be verbose on the console." }
		{ name: 'work-item-guid', alias: 'w', type: String, description: "Optional work item GUID, with or without dashes, e.g. '005056BD-A0FF-1EDB-83F6-92FDA092DD16'." },
		{ name: 'work-item-number', alias: 'n', type: String, description: "Work item number, e.g. '3200002672', to match against the work item opened, and the description of the TMS transport request." }
];

const optionUsage = commandLineUsage([
		{ header: "assign-transport-request", content: "Assign transport request to work item." },
		{ header: "Synopsis", content: [
				"$ assign-transport-request -t C0000000000000004207 -w 005056BD-A0FF-1EDB-83F6-92FDA092DD16 -n 3200000665",
				"$ assign-transport-request -t 4207 -n 3200000665",
				'$ assign-transport-request --help']},
		{ header: 'Options', optionList: optionDefinitions },
		{ header: 'Environment Variables', content: [
				{name: 'SOLMAN_USER',	desc: 'User name for the Solution Manager (SolMan) connection.'},
				{name: 'SOLMAN_PASS',	desc: 'Password for the SolMan connection.'}]
		}
]);

async function getWorkItemGuid(options, encUserPwd) {
		let workItemGuid = options['work-item-guid'];
		if(!workItemGuid) {
				const odataUrl = `https://${options['solman-host']}/sap/opu/odata/SALM/MC_SRV/DocTypeSet('S1CG%3BS1MJ')/DocWorkItems?sap-language=en&$filter=Id%20eq%20%27${options['work-item-number']}%27&$select=Guid,Id&$format=json`;
				// With SALM/MC_SRV, we get a 500 'Field symbol has not been assigned yet' when there is no hit.
				let response;
				try {
						response = await axios.get(odataUrl, {
								headers: {'Authorization': `Basic ${encUserPwd}`},
								httpsAgent: new https.Agent({
										ca: fs.readFileSync('/etc/ssl/certs/ca-certificates.crt')
								})
						});
						debugger;
						workItemGuid = response.data.d.results[0].Guid;
						console.error(`Info: GUID for ${options['work-item-number']} is ${workItemGuid}`);
				} catch (err) {
						console.error(`Error: GUID of work item ${options['work-item-number']} is unknown`);
						throw err;
				}
		}
		workItemGuid = workItemGuid.replace(/-/g, '').toUpperCase();
		if(!workItemGuid) {
				throw new Error(`work item GUID is unknown`);
		}
		return workItemGuid;
}

function getTransportRequest(transportRequest) {
		// 'C0000000000000004037'
		let retVal;
		const matches = transportRequest.match(/^((C\d{19})|(\d+))$/);
		if(!Array.isArray(matches)) { throw new Error(`transport request ${transportRequest} doesn't match expected pattern`); }
		if(matches[2]) { retVal = transportRequest; } else { retVal = sprintf("C%019s", matches[3]); }
		return retVal;
}

async function logoffBrowserClose(browser, page) {

		await page.evaluate(() => {
				crmuifClient.winMan.closeAll();
				crmuifClient.logOff();
		});
		console.error(`Info: logged off`);

		await browser.close();
		console.error(`Info: closed browser`);
}

async function assignTransportRequest(options, pageUser, pagePwd) {
		const encUserPwd = Buffer.from(`${pageUser}:${pagePwd}`).toString('base64');

		// Do we have a work item GUID?
		const workItemGuid = await getWorkItemGuid(options, encUserPwd);
		console.error(`Info: opening work item ${workItemGuid}`);

		const transportRequest = getTransportRequest(options['transport-request']);
		console.error(`Info: transport request ${transportRequest}`);
		//return 1;

		const browser = await puppeteer.launch({
				args: [
						'--no-sandbox', //'--disable-setuid-sandbox',
						'--disable-dev-shm-usage'
				],
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

		console.error(`Info: opening crm_ui_start`);

		const crmUiStart = `https://${options['solman-host']}/sap/bc/bsp/sap/crm_ui_start/default.htm`;

		await page.goto(`${crmUiStart}?saml2=disabled&CRM-OBJECT-TYPE=AIC_OB_CMNC&CRM-OBJECT-ACTION=B&CRM-OBJECT-VALUE=${workItemGuid}&saprole=%2fSALM%2fDEVEL`,
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
				const messages = await frame.evaluate(() => {
						// ["2 Messages ", "", " ", "There is no valid business partner assigned to your user", "", " ", "Transaction 3200000665 is being processed by user 9ASPTMS"]
						return [...document.querySelectorAll("[id='msgContainer'] span")].map((item) => {return item.textContent});
				});
				const lockMessages = messages.filter((item) => {
						return /^Transaction.*is being processed by user/.test(item); });

				if(lockMessages.length) {

						console.error(`Error: ${lockMessages}`);
						await logoffBrowserClose(browser, page);
						return 2; // WI is locked
				} else {
						throw err;
				}
		}

		console.error('Info: editing work item');

		try {
				// document.evaluate("//div[@id='msgContainer']//span[text()='Transaction 3200000665 saved']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE)
				const btnTransportManagement = await frame.waitForXPath("//td[text()='Transport Management']");
				await btnTransportManagement.click();
				const btnMore = await frame.waitForXPath("//div[@id='thtmlbOverviewPageBox']//b[text()='More']");
				// kajanl: Shameful, but maybe this helps:
				await frame.waitForTimeout(500);
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
				//"https://***.com/sap(====)/bc/bsp/sap/bsp_wd_base/popup_buffered_frame_cached.htm?sap-client=010&sap-language=EN&sap-domainRelax=min"
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
						//await popupFrame.type("[id='C25_W87_V88_V89_searchquerynode_parameters[2].VALUE1']", transportRequest);
						// kajanl: Attention: /soon/ after clicking the CP item, its value is cleared. I found no good way to tell when this is, hence the (shameful) waitForTimeout().
						// 	.type() is not much better: it's sensitive to mouse moves, when it is not run headless.
						await popupFrame.waitForTimeout(500);
						await popupFrame.evaluate((transportRequest) => {
								document.getElementById("C25_W87_V88_V89_searchquerynode_parameters[2].VALUE1").value = transportRequest;
						}, transportRequest);
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
						await popupPage.screenshot({path: './errorOnPopup.png'});
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

		try {
				await frame.click("[id='C13_W39_V41_SAVE']");
				await frame.waitForSelector("[id='submitInProgress']", {hidden: true});
				await frame.waitForSelector("[id='CRMMessageLine1']");
				// There may be multiple messages, e.g. 'There is no valid business partner assigned to your user'
				await frame.waitForXPath(`//div[@id='msgContainer']//span[text()='Transaction ${options['work-item-number']} saved']`);

				console.error(`Info: saved work item`);

				await frame.click("[id='C13_W39_V41_DISPLAY']");
				await frame.waitForSelector("[id='C13_W39_V41_DISPLAY'].th-bt-text-dis");

				console.error(`Info: switched to 'Display'`);

				await logoffBrowserClose(browser, page);
				return 0;
		} catch (err) {
				await page.screenshot({path: './errorAfterSave.png'});
				throw err;
		}
}

(async () => {
		let retCode = 0;
		//
		process.on('unhandledRejection', (reason, p) => {
				console.error('Unhandled Rejection at:', p, 'reason:', reason)
				process.exit(1)
		});

		// Env
		const pageUser = process.env.SOLMAN_USER;
		const pagePwd = process.env.SOLMAN_PASS;

		// Command line
		const options = commandLineArgs(optionDefinitions);
		let printHelp = false;

		// Sanity
		if (options.help) {
				printHelp = true;
		} else {
				if (!options['solman-host']) {

						console.error("Error: 'solman-host' is not given, use --solman-host option.");
						printHelp = true;
				} else if (!options["transport-request"]) {

						console.error("Error: 'transport-request' is not given, use --transport-request option.");
						printHelp = true;
				} else if (!options["work-item-number"]) {

						console.error("Error: 'work-item-number' is not given, use --work-item-number option.");
						printHelp = true;
				} else if (!pageUser) {

						console.error("Error: 'SOLMAN_USER' is not defined in the environment.");
						printHelp = true;
				} else if (!pagePwd) {

						console.error("Error: 'SOLMAN_PASS' is not defined in the environment.");
						printHelp = true;
				}
		}
		//
		if (printHelp) {

				console.log(optionUsage);
				if (!options.help) { retCode = 1; }
		} else {

				if (!options["work-item-guid"]) {
						console.log("Info: 'work-item-guid' is not given, it will be deduced from the work item number.");
				}

				retCode = await assignTransportRequest(options, pageUser, pagePwd);
		}
		process.exitCode = retCode;
		return retCode;
})();

// vim:noet:ts=4:
