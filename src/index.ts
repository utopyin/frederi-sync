import { Hono } from "hono";
import { protect } from "./auth";
import { APIErrorCode, Client, isNotionClientError } from "@notionhq/client";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { DATABASES_IDS } from "./notion";

export type Env = {
	Bindings: {
		NOTION_TOKEN: string;
		PASSWORD: string;
		GOOGLE_API_KEY: string;
		GCP_SERVICE_ACCOUNT: string;
	};
};

const app = new Hono<Env>();

app.use(protect);

app.onError((error, c) => {
	console.log(error);
	if (isNotionClientError(error)) {
		switch (error.code) {
			case APIErrorCode.Unauthorized:
				return c.json(
					{ message: "Notion responded with an unauthorized error" },
					401
				);
		}
	}
	return c.json({ message: "An error occurred" }, 500);
});
app.get("/public", async (c) => {
	return c.text("Hello World");
}).post(
	"/ios-contact",
	zValidator(
		"json",
		z
			.object({
				firstName: z.string().optional(),
				organization: z.string().optional(),
				lastName: z.string(),
				emails: z
					.object({
						email: z.string().email(),
						label: z.string(),
					})
					.array()
					.optional(),
				addresses: z
					.object({
						city: z.string().optional(),
						street: z.string().optional(),
						country: z.string().optional(),
						zip: z.string().optional(),
						state: z.string().optional(),
						label: z.string().optional(),
					})
					.optional()
					.array()
					.optional(),
				phones: z
					.object({
						label: z.string(),
						number: z.string(),
					})
					.array()
					.optional(),
				note: z.string().optional(),
				website: z.string().optional(),
				jobTitle: z.string().optional(),
				source: z
					.enum(["ios-contact"])
					.optional()
					.default("ios-contact"),
			})
			.array(),
		(r, c) => {
			console.log(r.data);
		}
	),
	async (c) => {
		const [
			{
				lastName,
				jobTitle,
				organization,
				emails,
				firstName,
				note,
				phones,
				addresses,
				website,
				source,
			},
		] = c.req.valid("json");

		const workEmail = emails?.filter((email) => email.label === "Work")[0]
			?.email;
		const homeEmail = emails?.filter((email) => email.label === "Home")[0]
			?.email;

		const mainPhone = phones?.filter((phone) => phone.label === "Main")[0]
			?.number;
		const workPhone = phones?.filter((phone) => phone.label === "Work")[0]
			?.number;
		const mobilePhone = phones?.filter((phone) =>
			["iPhone", "Mobile"].includes(phone.label)
		)[0]?.number;
		const homePhone = phones?.filter((phone) => phone.label === "Home")[0];

		const workAddressData = addresses?.filter(
			(address) => address?.label === "Work"
		)[0];

		let workAddress = "";
		if (workAddressData?.street)
			workAddress += workAddressData.street + " ";
		if (workAddressData?.zip) workAddress += workAddressData.zip + " ";
		if (workAddressData?.city) workAddress += workAddressData.city + " ";
		if (workAddressData?.country)
			workAddress += workAddressData.country + " ";

		const homeAddressData = addresses?.filter(
			(address) => address?.label === "Home"
		)[0];

		let homeAddress = "";
		if (homeAddressData?.street)
			homeAddress += homeAddressData.street + " ";
		if (homeAddressData?.zip) homeAddress += homeAddressData.zip + " ";
		if (homeAddressData?.city) homeAddress += homeAddressData.city + " ";
		if (homeAddressData?.country)
			homeAddress += homeAddressData.country + " ";

		const notion = new Client({
			auth: c.env.NOTION_TOKEN,
		});

		let organizationId: string | undefined = undefined;
		if (organization) {
			organizationId = (
				await notion.databases.query({
					database_id: DATABASES_IDS.organizations,
					filter: {
						property: "Name",
						title: {
							equals: organization,
						},
					},
				})
			).results[0]?.id;
			if (organizationId === undefined) {
				const createResponse = await notion.pages.create({
					parent: {
						database_id: DATABASES_IDS.organizations,
					},
					properties: {
						Name: {
							title: [
								{
									text: {
										content: organization,
									},
								},
							],
						},
					},
				});
				organizationId = createResponse.id;
			}
		}

		const properties = {
			"Last Name": {
				title: [
					{
						text: {
							content: lastName,
						},
					},
				],
			},
			...(firstName && {
				"First Name": {
					rich_text: [
						{
							text: {
								content: firstName,
							},
						},
					],
				},
			}),
			...(workEmail && {
				"Email (Work)": {
					email: workEmail,
				},
			}),
			...(homeEmail && {
				"Email (Home)": {
					email: homeEmail,
				},
			}),
			...(mainPhone && {
				Main: {
					phone_number: mainPhone,
				},
			}),
			...(workPhone && {
				Work: {
					phone_number: workPhone,
				},
			}),
			...(mobilePhone && {
				Mobile: {
					phone_number: mobilePhone,
				},
			}),
			...(homePhone && {
				Home: {
					phone_number: homePhone.number,
				},
			}),
			...(workAddressData && {
				"Address (Work)": {
					rich_text: [
						{
							text: {
								content: workAddress,
							},
						},
					],
				},
			}),
			...(homeAddressData && {
				"Address (Home)": {
					rich_text: [
						{
							text: {
								content: homeAddress,
							},
						},
					],
				},
			}),
			...(note && {
				"iOS Notes": {
					rich_text: [
						{
							text: {
								content: note ?? "",
							},
						},
					],
				},
			}),
			...(website && {
				Website: {
					url: website ?? "",
				},
			}),
			...(jobTitle && {
				"Job Title": {
					rich_text: [
						{
							text: {
								content: jobTitle,
							},
						},
					],
				},
			}),
			...(organization && {
				Organization: {
					relation: [{ id: organizationId as string }],
				},
			}),
			Source: {
				select: {
					name: source == "ios-contact" ? "iOS Contact" : source,
				},
			},
		};

		const retrieveResponse = await notion.databases.query({
			database_id: DATABASES_IDS.contacts,
			filter: {
				and: [
					{
						property: "Last Name",
						title: {
							equals: lastName,
						},
					},
					{
						property: "First Name",
						rich_text: {
							equals: firstName ?? "",
						},
					},
				],
			},
		});

		// if none exists
		if (retrieveResponse.results.length === 0) {
			// create it

			const createResponse = await notion.pages.create({
				parent: {
					database_id: DATABASES_IDS.contacts,
				},
				properties,
			});

			return c.json(
				{
					message: "Successfully created contact",
					pageId: createResponse.id,
					firstName: firstName,
					lastName: lastName,
				},
				201
			);
		}

		const updateResponse = await notion.pages.update({
			page_id: retrieveResponse.results[0].id,
			properties,
		});

		return c.json({
			message: "Successfully updated contact",
			firstName: firstName,
			lastName: lastName,
			pageId: updateResponse.id,
		});
	}
);

export default app;
