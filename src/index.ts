import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import bodyParser from 'body-parser';
import * as dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import { GitLabMergeRequestPayload } from './types';

// Load environment variables
dotenv.config();

const app = express();
// Parse JSON body, but also keep the raw body for potential signature verification (not needed for GitLab token)
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const GITLAB_WEBHOOK_SECRET = process.env.GITLAB_WEBHOOK_SECRET;
const GITLAB_PAT = process.env.GITLAB_PAT;
const GITLAB_URL = process.env.GITLAB_URL;

// Initialize the Gemini Client. It automatically uses GEMINI_API_KEY from the environment.
const ai = new GoogleGenAI({});

/**
 * * CORE FUNCTION: Handles the AI Code Review
 */
async function performCodeReview(projectId: number, mergeRequestId: number, diffUrl: string): Promise<void> {
	if (!GITLAB_PAT || !GITLAB_URL) {
		console.error('GitLab credentials are not set in environment variables.');
		return;
	}

	try {
		// 1. Fetch the Raw Diff from GitLab
		// Using `responseType: 'text'` ensures we get the raw diff string
		const diffResponse = await axios.get<string>(diffUrl, {
			headers: {
				'Private-Token': GITLAB_PAT,
				Accept: 'text/plain',
			},
		});

		const rawDiff = (diffResponse.data as any)?.changes;

		// 2. Construct the Prompt
		const prompt = `You are an expert AI Code Reviewer for Node.js (TypeScript/JavaScript) and Flutter/Dart projects. Analyze the provided GitLab merge request diff for bugs, security vulnerabilities, performance issues, and style guide violations. Please adhere to the following guidelines:

Provide your feedback in a concise, Markdown-formatted list. Use inline code suggestions if you find a specific fix.
- Review Principles
1. Conciseness: Focus on the most critical issues (bugs, security, performance).
2. Formatting: Use clear Markdown formatting.
3. Suggestions: Provide inline code suggestions where applicable.
4. Priority: Prioritize issues that could lead to bugs or security vulnerabilities.
5. Specificity: Avoid generic feedback; be specific to the code changes.
6. Scope: If the diff is too large, focus on the first 500 lines.
7. Conclusion: If no issues are found, respond with "No issues found."

- Strict Naming Convention Enforcement
All identifiers must strictly adhere to the following prefixes/suffixes using PascalCase:

1. Enum: Must start with E (e.g., EUserRole, EPaymentStatus).
2. DTO (Data Transfer Object): Must start with DTO (e.g., DTOUserCreate, DTOProduct).
3. Interface: Must start with I (e.g., IUser, IUserRepository).
4. Type Alias (TS): Must start with T (e.g., TUserID, TProductPayload).
5. Abstract Class: Must start with A (e.g., AEntity, AUserState).
6. Repository/Data Access Class: Must start with R (e.g., RUserRepository, RRemoteDataSource).
7. Utility/Helper Class/Function: Must start with U (e.g., UHelper, UDateTimeUtils).
8. Custom Error Class: Must end with Error (e.g., NotFoundError, TimeoutError).
9. Custom Exception Class: Must end with Exception (e.g., AuthException, ValidationException).

- Platform-Specific Naming
1. Node.js / TypeScript
+ Database Model Class/Entity: Use PascalCase and end with Entity (e.g., UserEntity, ProductEntity).
+ Test Class/Function: Use snake_case describing the test purpose (e.g., test_user_creation, should_fetch_products).
+ Environment Variable: Use UPPER_CASE_SNAKE (e.g., DATABASE_URL, API_KEY).

2. Flutter / Dart
+ Widget (Component): Use PascalCase (e.g., UserProfileWidget, ProductListScreen).
+ Provider/BLoC/Cubit: Use PascalCase (e.g., UserProvider, AuthCubit).
+ Hook (Composable Function): Must start with use and use camelCase (e.g., useAuth, useFetchUser).
+ Frontend Styling (General)
+ CSS/SCSS Class: Use kebab-case (e.g., user-profile, product-list).
+ SCSS Variable: Must start with $ and use kebab-case (e.g., $primary-color, $font-size).
+ HTML/JSX/Widget Data Attribute: Must start with data- and use kebab-case (e.g., data-user-id).

You should only respond with the review comments in Markdown format. Do not include any explanations or apologies.
Please use diff context to inform your review, but do not repeat the entire diff in your response.
Please focus solely on the code quality and issues.
No review too long to avoid timeouts.
Here is the diff to review (if too large, focus on the first 500 lines):
---
${JSON.stringify(rawDiff, null, 2)}
---`;

		// 3. Call the Gemini API
		console.log(`Sending diff to Gemini for MR !${mergeRequestId}...`);
		const geminiResponse = await ai.models.generateContent({
			model: 'gemini-2.5-flash', // Good balance of speed and quality
			contents: prompt,
		});

		const reviewText = geminiResponse?.text?.trim();

		// 4. Post the Review as a Comment to the MR
		const commentBody = {
			body: `🤖 **AI Code Review (Powered by Gemini)**\n\n${reviewText}`,
		};

		const postCommentUrl = `${GITLAB_URL}/projects/${projectId}/merge_requests/${mergeRequestId}/notes`;

		await axios.post(postCommentUrl, commentBody, {
			headers: {
				'Private-Token': GITLAB_PAT,
				'Content-Type': 'application/json',
			},
		});

		console.log(`Successfully posted review to MR !${mergeRequestId}.`);
	} catch (error) {
		console.error(`Error during code review process for MR !${mergeRequestId}:`, (error as Error).message);
		// In a real application, you might want to log this or post a "Review Failed" comment.
	}
}

// --- Webhook Endpoint ---
app.post('/gitlab-webhook', async (req: Request, res: Response) => {
	const gitlabToken = req.headers['x-gitlab-token'];
	const event = req.headers['x-gitlab-event'];

	// 1. Webhook Secret Verification
	if (!gitlabToken || gitlabToken !== GITLAB_WEBHOOK_SECRET) {
		console.warn('Webhook verification failed: Invalid secret token.');
		return res.status(401).send('Unauthorized: Invalid secret token.');
	}

	// 2. Event Filtering
	if (event !== 'Merge Request Hook') {
		return res.status(200).send('Event received, but not a Merge Request Hook. Ignored.');
	}

	// Cast the body to our defined interface for type safety
	const payload: GitLabMergeRequestPayload = req.body;
	const action = payload.object_attributes.action;

	// Only process when MR is opened or updated (e.g., new commits pushed)
	if (action !== 'open' && action !== 'update') {
		return res.status(200).send(`MR event action '${action}' ignored.`);
	}

	// 3. Extract necessary data
	const projectId = payload.project.id;
	const mergeRequestId = payload.object_attributes.iid;

	// URL to fetch the raw diff of the MR changes.
	const diffUrl = `${GITLAB_URL}/projects/${projectId}/merge_requests/${mergeRequestId}/changes`;

	console.log(`Received MR !${mergeRequestId} event: ${action}. Starting async review...`);

	// Start the heavy lifting outside the response path
	await performCodeReview(projectId, mergeRequestId, diffUrl);

	// **4. Respond Immediately & Process Asynchronously**
	// This is vital. Respond 202 quickly and run the review in the background.
	res.status(202).send('Webhook accepted. Review process started.');
});

app.post('/payments/sepay/webhook', async (req, res) => {
	console.log('🚀 ~ req:', req.body);
	return res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`GitLab Reviewer listening on port ${PORT}`);
});