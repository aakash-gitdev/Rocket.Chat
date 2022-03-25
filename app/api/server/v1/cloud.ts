import { check } from 'meteor/check';
import { format } from 'date-fns';
// import { HTTP } from 'meteor/http';

import { API } from '../api';
import { hasPermission } from '../../../authorization/server';
import { saveRegistrationData } from '../../../cloud/server/functions/saveRegistrationData';
import { retrieveRegistrationStatus } from '../../../cloud/server/functions/retrieveRegistrationStatus';
import { startRegisterWorkspaceSetupWizard } from '../../../cloud/server/functions/startRegisterWorkspaceSetupWizard';
import { getConfirmationPoll } from '../../../cloud/server/functions/getConfirmationPoll';
// import { getWorkspaceAccessToken } from '../../../cloud/server/functions/getWorkspaceAccessToken';
import { getLicenses } from '../../../../ee/app/license/server/license';
import { getUpgradeTabType } from '../../../../lib/getUpgradeTabType';
import { settings } from '../../../settings/server';

API.v1.addRoute(
	'cloud.manualRegister',
	{ authRequired: true },
	{
		async post() {
			check(this.bodyParams, {
				cloudBlob: String,
			});

			if (!hasPermission(this.userId, 'register-on-cloud')) {
				return API.v1.unauthorized();
			}

			const registrationInfo = retrieveRegistrationStatus();

			if (registrationInfo.workspaceRegistered) {
				return API.v1.failure('Workspace is already registered');
			}

			const settingsData = JSON.parse(Buffer.from(this.bodyParams.cloudBlob, 'base64').toString());

			await saveRegistrationData(settingsData);

			return API.v1.success();
		},
	},
);

API.v1.addRoute(
	'cloud.createRegistrationIntent',
	{ authRequired: true },
	{
		async post() {
			check(this.bodyParams, {
				resend: Boolean,
				email: String,
			});

			if (!hasPermission(this.userId, 'manage-cloud')) {
				return API.v1.unauthorized();
			}

			const intentData = await startRegisterWorkspaceSetupWizard(this.bodyParams.resend, this.bodyParams.email);

			if (intentData) {
				return API.v1.success({ intentData });
			}

			return API.v1.failure('Invalid query');
		},
	},
);

API.v1.addRoute(
	'cloud.confirmationPoll',
	{ authRequired: true },
	{
		async get() {
			const { deviceCode } = this.queryParams;
			check(this.queryParams, {
				deviceCode: String,
			});

			if (!hasPermission(this.userId, 'manage-cloud')) {
				return API.v1.unauthorized();
			}

			if (!deviceCode) {
				return API.v1.failure('Invalid query');
			}

			const pollData = await getConfirmationPoll(deviceCode);
			if (pollData) {
				if ('successful' in pollData && pollData.successful) {
					Promise.await(saveRegistrationData(pollData.payload));
				}
				return API.v1.success({ pollData });
			}

			return API.v1.failure('Invalid query');
		},
	},
);

API.v1.addRoute(
	'cloud.getUpgradeTabParams',
	{ authRequired: true },
	{
		async get() {
			if (!hasRole(this.userId, 'admin')) {
				return API.v1.unauthorized();
			}

			const { workspaceRegistered } = retrieveRegistrationStatus();

			const licenses = getLicenses()
				.filter(({ valid }) => valid)
				.map(({ license }) => license);

			// find any license that has trial
			const trialLicense = licenses.find(({ meta }) => meta?.trial);

			// if at least one license isn't trial, workspace isn't considered in trial
			const isTrial = !licenses.map(({ meta }) => meta?.trial).includes(false);
			const hasGoldLicense = licenses.map(({ tag }) => tag?.name === 'gold').includes(true);
			const trialEndDate = trialLicense ? format(new Date(trialLicense.expiry), 'yyyy-MM-dd') : undefined;

			const hadExpiredTrials = Boolean(settings.get('Cloud_Workspace_Had_Trial'));

			const upgradeTabType = getUpgradeTabType({
				registered: workspaceRegistered,
				hasValidLicense: licenses.length > 0,
				hadExpiredTrials,
				isTrial,
				hasGoldLicense,
			});

			return API.v1.success({ tabType: upgradeTabType, trialEndDate });
		},
	},
);
