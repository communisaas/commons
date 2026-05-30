/**
 * OpenAPI 3.1 specification for the Commons Public API.
 *
 * Generated from endpoint source code — keep in sync with route handlers.
 */

export const openApiSpec = {
	openapi: '3.1.0',
	info: {
		title: 'Commons Public API',
		version: '1.0.0',
		description:
			'Public REST API for Commons — campaign management, supporter CRM, and verified civic action. All endpoints require Bearer token authentication via API key (prefix ck_live_). Rate limited to 100 requests per minute per key.'
	},
	servers: [{ url: '/api/v1' }],
	security: [{ bearerAuth: [] }],
	paths: {
		'/': {
			get: {
				operationId: 'getApiRoot',
				summary: 'API root',
				description: 'Returns API version and documentation link. No authentication required.',
				security: [],
				responses: {
					'200': {
						description: 'API version info',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'object',
											properties: {
												version: { type: 'string', example: 'v1' },
												documentation: { type: 'string', example: '/api/v1/docs' }
											}
										}
									}
								}
							}
						}
					}
				}
			}
		},
		'/orgs': {
			get: {
				operationId: 'getOrg',
				summary: 'Get organization',
				description: 'Returns the organization bound to the API key. Requires read scope.',
				responses: {
					'200': {
						description: 'Organization details',
						content: {
							'application/json': {
								schema: {
									$ref: '#/components/schemas/OrgResponse'
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'500': { $ref: '#/components/responses/InternalError' }
				}
			}
		},
		'/supporters': {
			get: {
				operationId: 'listSupporters',
				summary: 'List supporters',
				description: 'List supporters with cursor pagination and optional filters. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/cursor' },
					{ $ref: '#/components/parameters/limit' },
					{ name: 'email', in: 'query', schema: { type: 'string' }, description: 'Filter by exact email (case-insensitive)' },
					{ name: 'verified', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Filter by verification status' },
					{ name: 'email_status', in: 'query', schema: { type: 'string', enum: ['subscribed', 'unsubscribed', 'bounced', 'complained'] }, description: 'Filter by email subscription status' },
					{ name: 'source', in: 'query', schema: { type: 'string', enum: ['csv', 'action_network', 'organic', 'widget'] }, description: 'Filter by import source' },
					{ name: 'tag', in: 'query', schema: { type: 'string' }, description: 'Filter by tag ID' }
				],
				responses: {
					'200': {
						description: 'Paginated list of supporters',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/Supporter' } },
										meta: { $ref: '#/components/schemas/PaginationMeta' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			},
			post: {
				operationId: 'createSupporter',
				summary: 'Create supporter',
				description: 'Create a new supporter. Requires write scope. Duplicate emails return 409.',
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/CreateSupporterInput' }
						}
					}
				},
				responses: {
					'201': {
						description: 'Supporter created',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/Supporter' } }
								}
							}
						}
					},
					'400': { $ref: '#/components/responses/BadRequest' },
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'409': { $ref: '#/components/responses/Conflict' }
				}
			}
		},
		'/supporters/{id}': {
			get: {
				operationId: 'getSupporter',
				summary: 'Get supporter',
				description: 'Get a single supporter by ID. Requires read scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				responses: {
					'200': {
						description: 'Supporter details',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/Supporter' } }
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			},
			patch: {
				operationId: 'updateSupporter',
				summary: 'Update supporter',
				description: 'Update supporter fields. Requires write scope. At least one field must be provided.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/UpdateSupporterInput' }
						}
					}
				},
				responses: {
					'200': {
						description: 'Supporter updated',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'object',
											properties: {
												id: { type: 'string' },
												updatedAt: { type: 'string', format: 'date-time' }
											}
										}
									}
								}
							}
						}
					},
					'400': { $ref: '#/components/responses/BadRequest' },
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			},
			delete: {
				operationId: 'deleteSupporter',
				summary: 'Delete supporter',
				description: 'Permanently delete a supporter. Requires write scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				responses: {
					'200': {
						description: 'Supporter deleted',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'object',
											properties: { deleted: { type: 'boolean', example: true } }
										}
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/campaigns': {
			get: {
				operationId: 'listCampaigns',
				summary: 'List campaigns',
				description: 'List campaigns with cursor pagination and optional filters. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/cursor' },
					{ $ref: '#/components/parameters/limit' },
					{ name: 'status', in: 'query', schema: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'] }, description: 'Filter by campaign status' },
					{ name: 'type', in: 'query', schema: { type: 'string', enum: ['LETTER', 'EVENT', 'FORM'] }, description: 'Filter by campaign type' }
				],
				responses: {
					'200': {
						description: 'Paginated list of campaigns',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/Campaign' } },
										meta: { $ref: '#/components/schemas/PaginationMeta' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			},
			post: {
				operationId: 'createCampaign',
				summary: 'Create campaign',
				description: 'Create a new campaign in DRAFT status. Requires write scope.',
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/CreateCampaignInput' }
						}
					}
				},
				responses: {
					'201': {
						description: 'Campaign created',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/CampaignDetail' } }
								}
							}
						}
					},
					'400': { $ref: '#/components/responses/BadRequest' },
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			}
		},
		'/campaigns/{id}': {
			get: {
				operationId: 'getCampaign',
				summary: 'Get campaign',
				description: 'Get a single campaign by ID. Requires read scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				responses: {
					'200': {
						description: 'Campaign details',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/CampaignFull' } }
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			},
			patch: {
				operationId: 'updateCampaign',
				summary: 'Update campaign',
				description: 'Update campaign fields. Requires write scope. At least one field must be provided.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/UpdateCampaignInput' }
						}
					}
				},
				responses: {
					'200': {
						description: 'Campaign updated',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'object',
											properties: {
												id: { type: 'string' },
												updatedAt: { type: 'string', format: 'date-time' }
											}
										}
									}
								}
							}
						}
					},
					'400': { $ref: '#/components/responses/BadRequest' },
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/campaigns/{id}/actions': {
			get: {
				operationId: 'listCampaignActions',
				summary: 'List campaign actions',
				description: 'List actions taken on a campaign with cursor pagination. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/resourceId' },
					{ $ref: '#/components/parameters/cursor' },
					{ $ref: '#/components/parameters/limit' },
					{ name: 'verified', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Filter by verification status' }
				],
				responses: {
					'200': {
						description: 'Paginated list of campaign actions',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/CampaignAction' } },
										meta: { $ref: '#/components/schemas/PaginationMeta' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/tags': {
			get: {
				operationId: 'listTags',
				summary: 'List tags',
				description: 'List all tags for the organization. Requires read scope. Ordered alphabetically.',
				responses: {
					'200': {
						description: 'List of tags',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/Tag' } }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			},
			post: {
				operationId: 'createTag',
				summary: 'Create tag',
				description: 'Create a new tag. Requires write scope. Duplicate names return 409.',
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['name'],
								properties: {
									name: { type: 'string', description: 'Tag name' }
								}
							}
						}
					}
				},
				responses: {
					'201': {
						description: 'Tag created',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'object',
											properties: {
												id: { type: 'string' },
												name: { type: 'string' }
											}
										}
									}
								}
							}
						}
					},
					'400': { $ref: '#/components/responses/BadRequest' },
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'409': { $ref: '#/components/responses/Conflict' }
				}
			}
		},
		'/tags/{id}': {
			patch: {
				operationId: 'updateTag',
				summary: 'Rename tag',
				description: 'Rename a tag. Requires write scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['name'],
								properties: {
									name: { type: 'string', description: 'New tag name' }
								}
							}
						}
					}
				},
				responses: {
					'200': {
						description: 'Tag renamed',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'object',
											properties: {
												id: { type: 'string' },
												name: { type: 'string' }
											}
										}
									}
								}
							}
						}
					},
					'400': { $ref: '#/components/responses/BadRequest' },
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			},
			delete: {
				operationId: 'deleteTag',
				summary: 'Delete tag',
				description: 'Permanently delete a tag. Requires write scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				responses: {
					'200': {
						description: 'Tag deleted',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'object',
											properties: { deleted: { type: 'boolean', example: true } }
										}
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/usage': {
			get: {
				operationId: 'getUsage',
				summary: 'Get billing usage',
				description: 'Returns current billing period usage for the organization. Requires read scope.',
				responses: {
					'200': {
						description: 'Usage data',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { $ref: '#/components/schemas/Usage' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			}
		},
		'/keys': {
			post: {
				operationId: 'createApiKey',
				summary: 'Create API key',
				description: 'Create a new API key. Requires session authentication (org owner or editor role), not Bearer token auth. The full key is returned only once in the response.',
				security: [],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/CreateApiKeyInput' }
						}
					}
				},
				responses: {
					'201': {
						description: 'API key created (key shown once)',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/ApiKeyCreated' } }
								}
							}
						}
					},
					'400': { $ref: '#/components/responses/BadRequest' },
					'401': { $ref: '#/components/responses/Unauthorized' }
				}
			}
		},
		'/keys/{id}': {
			patch: {
				operationId: 'renameApiKey',
				summary: 'Rename API key',
				description: 'Rename an API key. Requires session authentication (org owner or editor role). Pass orgSlug as query parameter.',
				security: [],
				parameters: [
					{ $ref: '#/components/parameters/resourceId' },
					{ name: 'orgSlug', in: 'query', required: true, schema: { type: 'string' }, description: 'Organization slug' }
				],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['name'],
								properties: {
									name: { type: 'string', description: 'New key name' }
								}
							}
						}
					}
				},
				responses: {
					'200': {
						description: 'Key renamed',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'object',
											properties: {
												id: { type: 'string' },
												name: { type: 'string' }
											}
										}
									}
								}
							}
						}
					},
					'400': { $ref: '#/components/responses/BadRequest' },
					'401': { $ref: '#/components/responses/Unauthorized' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			},
			delete: {
				operationId: 'revokeApiKey',
				summary: 'Revoke API key',
				description: 'Revoke (soft-delete) an API key. Requires session authentication (org owner or editor role). Pass orgSlug as query parameter.',
				security: [],
				parameters: [
					{ $ref: '#/components/parameters/resourceId' },
					{ name: 'orgSlug', in: 'query', required: true, schema: { type: 'string' }, description: 'Organization slug' }
				],
				responses: {
					'200': {
						description: 'Key revoked',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'object',
											properties: { revoked: { type: 'boolean', example: true } }
										}
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/events': {
			get: {
				operationId: 'listEvents',
				summary: 'List events',
				description: 'List events with cursor pagination and optional filters. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/cursor' },
					{ $ref: '#/components/parameters/limit' },
					{ name: 'status', in: 'query', schema: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] }, description: 'Filter by event status' },
					{ name: 'eventType', in: 'query', schema: { type: 'string', enum: ['IN_PERSON', 'VIRTUAL', 'HYBRID'] }, description: 'Filter by event type' }
				],
				responses: {
					'200': {
						description: 'Paginated list of events',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/Event' } },
										meta: { $ref: '#/components/schemas/PaginationMeta' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			}
		},
		'/events/{id}': {
			get: {
				operationId: 'getEvent',
				summary: 'Get event',
				description: 'Get a single event by ID. Requires read scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				responses: {
					'200': {
						description: 'Event details',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/EventDetail' } }
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/donations': {
			get: {
				operationId: 'listDonations',
				summary: 'List donations',
				description: 'List donations with cursor pagination and optional filters. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/cursor' },
					{ $ref: '#/components/parameters/limit' },
					{ name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'completed', 'refunded'] }, description: 'Filter by donation status' },
					{ name: 'campaignId', in: 'query', schema: { type: 'string' }, description: 'Filter by campaign ID' }
				],
				responses: {
					'200': {
						description: 'Paginated list of donations',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/Donation' } },
										meta: { $ref: '#/components/schemas/PaginationMeta' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			}
		},
		'/donations/{id}': {
			get: {
				operationId: 'getDonation',
				summary: 'Get donation',
				description: 'Get a single donation by ID. Requires read scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				responses: {
					'200': {
						description: 'Donation details',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/DonationDetail' } }
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/workflows': {
			get: {
				operationId: 'listWorkflows',
				summary: 'List workflows',
				description: 'List automation workflows with cursor pagination and optional filters. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/cursor' },
					{ $ref: '#/components/parameters/limit' },
					{ name: 'enabled', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Filter by enabled status' }
				],
				responses: {
					'200': {
						description: 'Paginated list of workflows',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/Workflow' } },
										meta: { $ref: '#/components/schemas/PaginationMeta' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			}
		},
		'/workflows/{id}': {
			get: {
				operationId: 'getWorkflow',
				summary: 'Get workflow',
				description: 'Get a single workflow by ID including step definitions. Requires read scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				responses: {
					'200': {
						description: 'Workflow details',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/WorkflowDetail' } }
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/sms': {
			get: {
				operationId: 'listSmsBlasts',
				summary: 'List SMS blasts',
				description: 'List SMS blasts with cursor pagination and optional filters. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/cursor' },
					{ $ref: '#/components/parameters/limit' },
					{ name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'sending', 'sent', 'failed'] }, description: 'Filter by blast status' }
				],
				responses: {
					'200': {
						description: 'Paginated list of SMS blasts',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/SmsBlast' } },
										meta: { $ref: '#/components/schemas/PaginationMeta' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			}
		},
		'/calls': {
			get: {
				operationId: 'listCalls',
				summary: 'List patch-through calls',
				description: 'List patch-through calls with cursor pagination and optional filters. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/cursor' },
					{ $ref: '#/components/parameters/limit' },
					{ name: 'status', in: 'query', schema: { type: 'string', enum: ['initiated', 'ringing', 'in-progress', 'completed', 'failed', 'no-answer', 'busy'] }, description: 'Filter by call status' },
					{ name: 'campaignId', in: 'query', schema: { type: 'string' }, description: 'Filter by campaign ID' }
				],
				responses: {
					'200': {
						description: 'Paginated list of patch-through calls',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/PatchThroughCall' } },
										meta: { $ref: '#/components/schemas/PaginationMeta' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			}
		},
		'/representatives': {
			get: {
				operationId: 'listRepresentatives',
				summary: 'List representatives',
				description: 'List international representatives with cursor pagination and optional filters. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/cursor' },
					{ $ref: '#/components/parameters/limit' },
					{ name: 'country', in: 'query', schema: { type: 'string' }, description: 'Filter by ISO country code' },
					{ name: 'constituency', in: 'query', schema: { type: 'string' }, description: 'Filter by constituency ID' }
				],
				responses: {
					'200': {
						description: 'Paginated list of representatives',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/Representative' } },
										meta: { $ref: '#/components/schemas/PaginationMeta' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			}
		},
		'/networks': {
			get: {
				operationId: 'listNetworks',
				summary: 'List networks',
				description: 'List coalition networks the authenticated org belongs to. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/cursor' },
					{ $ref: '#/components/parameters/limit' }
				],
				responses: {
					'200': {
						description: 'Paginated list of networks',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { type: 'array', items: { $ref: '#/components/schemas/Network' } },
										meta: { $ref: '#/components/schemas/PaginationMeta' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			}
		},
		'/networks/{id}': {
			get: {
				operationId: 'getNetwork',
				summary: 'Get network detail',
				description: 'Returns network details including member list. Requires the org to be an active member. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/resourceId' }
				],
				responses: {
					'200': {
						description: 'Network detail with members',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { $ref: '#/components/schemas/NetworkDetail' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/networks/{id}/stats': {
			get: {
				operationId: 'getNetworkStats',
				summary: 'Get network stats',
				description: 'Returns aggregate statistics across all active member orgs in the network. Requires the org to be an active member. Requires read scope.',
				parameters: [
					{ $ref: '#/components/parameters/resourceId' }
				],
				responses: {
					'200': {
						description: 'Network aggregate statistics',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { $ref: '#/components/schemas/NetworkStats' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/webhooks': {
			get: {
				operationId: 'listWebhooks',
				summary: 'List webhook subscriptions',
				description:
					'Returns all webhook subscriptions for the authenticated org. Requires read scope.',
				responses: {
					'200': {
						description: 'Array of webhook subscriptions',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'array',
											items: { $ref: '#/components/schemas/Webhook' }
										}
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			},
			post: {
				operationId: 'createWebhook',
				summary: 'Create webhook subscription',
				description:
					'Subscribes an HTTPS endpoint to one or more org events. Returns the signing secret ONCE — store it now; Commons will never display it again. Requires write scope.',
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/CreateWebhookInput' }
						}
					}
				},
				responses: {
					'201': {
						description: 'Webhook created (with one-time signingSecret)',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/WebhookCreated' } }
								}
							}
						}
					},
					'400': { $ref: '#/components/responses/BadRequest' },
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' }
				}
			}
		},
		'/webhooks/{id}': {
			get: {
				operationId: 'getWebhook',
				summary: 'Get webhook subscription',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				responses: {
					'200': {
						description: 'Webhook subscription',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/Webhook' } }
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			},
			patch: {
				operationId: 'updateWebhook',
				summary: 'Update webhook subscription',
				description:
					'Update URL, events, enabled state, or description. Re-enabling resets the failureCount. Requires write scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/UpdateWebhookInput' }
						}
					}
				},
				responses: {
					'200': {
						description: 'Updated webhook subscription',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { data: { $ref: '#/components/schemas/Webhook' } }
								}
							}
						}
					},
					'400': { $ref: '#/components/responses/BadRequest' },
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			},
			delete: {
				operationId: 'deleteWebhook',
				summary: 'Delete webhook subscription',
				description: 'Removes the subscription and its delivery history. Requires write scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				responses: {
					'200': {
						description: 'Webhook deleted',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: {
											type: 'object',
											properties: { deleted: { type: 'boolean', enum: [true] } }
										}
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		},
		'/webhooks/{id}/rotate-secret': {
			post: {
				operationId: 'rotateWebhookSecret',
				summary: 'Rotate webhook signing secret',
				description:
					'Issues a new signing secret. The previous secret continues to verify within the rotation window so receivers can roll over without dropped deliveries. The new secret is returned ONCE. Requires write scope.',
				parameters: [{ $ref: '#/components/parameters/resourceId' }],
				responses: {
					'200': {
						description: 'New signing secret (returned once)',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										data: { $ref: '#/components/schemas/WebhookSecretRotated' }
									}
								}
							}
						}
					},
					'401': { $ref: '#/components/responses/Unauthorized' },
					'403': { $ref: '#/components/responses/Forbidden' },
					'404': { $ref: '#/components/responses/NotFound' }
				}
			}
		}
	},
	components: {
		securitySchemes: {
			bearerAuth: {
				type: 'http',
				scheme: 'bearer',
				description: 'API key with ck_live_ prefix'
			}
		},
		parameters: {
			resourceId: {
				name: 'id',
				in: 'path',
				required: true,
				schema: { type: 'string' },
				description: 'Resource ID'
			},
			cursor: {
				name: 'cursor',
				in: 'query',
				schema: { type: 'string' },
				description: 'Cursor for pagination (ID of last item from previous page)'
			},
			limit: {
				name: 'limit',
				in: 'query',
				schema: { type: 'integer', minimum: 1, maximum: 50, default: 50 },
				description: 'Number of items per page (max 50)'
			}
		},
		schemas: {
			PaginationMeta: {
				type: 'object',
				properties: {
					cursor: { type: ['string', 'null'], description: 'Cursor for next page, or null if no more pages' },
					hasMore: { type: 'boolean' },
					total: { type: 'integer', description: 'Total number of matching records' }
				}
			},
			Supporter: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					email: { type: 'string', format: 'email' },
					name: { type: ['string', 'null'] },
					postalCode: { type: ['string', 'null'] },
					country: { type: ['string', 'null'] },
					phone: { type: ['string', 'null'] },
					verified: { type: 'boolean' },
					emailStatus: { type: 'string' },
					source: { type: 'string' },
					customFields: { type: ['object', 'null'] },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' },
					tags: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								id: { type: 'string' },
								name: { type: 'string' }
							}
						}
					}
				}
			},
			CreateSupporterInput: {
				type: 'object',
				required: ['email'],
				properties: {
					email: { type: 'string', format: 'email', description: 'Supporter email (must contain @)' },
					name: { type: 'string' },
					postalCode: { type: 'string' },
					country: { type: 'string', default: 'US' },
					phone: { type: 'string' },
					source: { type: 'string', description: 'Import source identifier' },
					customFields: { type: 'object', description: 'Arbitrary key-value metadata' },
					tags: { type: 'array', items: { type: 'string' }, description: 'Array of tag IDs to attach' }
				}
			},
			UpdateSupporterInput: {
				type: 'object',
				properties: {
					name: { type: 'string' },
					postalCode: { type: 'string' },
					country: { type: 'string' },
					phone: { type: 'string' },
					customFields: { type: 'object' }
				},
				description: 'At least one field must be provided.'
			},
			Campaign: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					type: { type: 'string', enum: ['LETTER', 'EVENT', 'FORM'] },
					title: { type: 'string' },
					body: { type: ['string', 'null'] },
					status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'] },
					templateId: { type: ['string', 'null'] },
					debateEnabled: { type: 'boolean' },
					debateThreshold: { type: ['integer', 'null'] },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' },
					counts: {
						type: 'object',
						properties: {
							actions: { type: 'integer' },
							deliveries: { type: 'integer' }
						}
					}
				}
			},
			CampaignDetail: {
				type: 'object',
				description: 'Campaign as returned from POST (no counts)',
				properties: {
					id: { type: 'string' },
					type: { type: 'string', enum: ['LETTER', 'EVENT', 'FORM'] },
					title: { type: 'string' },
					body: { type: ['string', 'null'] },
					status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'] },
					templateId: { type: ['string', 'null'] },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' }
				}
			},
			CampaignFull: {
				type: 'object',
				description: 'Campaign detail with targets field',
				properties: {
					id: { type: 'string' },
					type: { type: 'string', enum: ['LETTER', 'EVENT', 'FORM'] },
					title: { type: 'string' },
					body: { type: ['string', 'null'] },
					status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'] },
					targets: { type: ['object', 'null'], description: 'Campaign target configuration' },
					templateId: { type: ['string', 'null'] },
					debateEnabled: { type: 'boolean' },
					debateThreshold: { type: ['integer', 'null'] },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' },
					counts: {
						type: 'object',
						properties: {
							actions: { type: 'integer' },
							deliveries: { type: 'integer' }
						}
					}
				}
			},
			CreateCampaignInput: {
				type: 'object',
				required: ['title', 'type'],
				properties: {
					title: { type: 'string', description: 'Campaign title (non-empty)' },
					type: { type: 'string', enum: ['LETTER', 'EVENT', 'FORM'] },
					body: { type: 'string', description: 'Campaign body text' },
					templateId: { type: 'string', description: 'ID of template to use (must belong to org)' }
				}
			},
			UpdateCampaignInput: {
				type: 'object',
				properties: {
					title: { type: 'string' },
					body: { type: 'string' },
					status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'] }
				},
				description: 'At least one field must be provided.'
			},
			CampaignAction: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					campaignId: { type: 'string' },
					supporterId: { type: ['string', 'null'] },
					verified: { type: 'boolean' },
					engagementTier: { type: 'integer' },
					districtHash: { type: ['string', 'null'] },
					sentAt: { type: 'string', format: 'date-time' },
					createdAt: { type: 'string', format: 'date-time' }
				}
			},
			Tag: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					name: { type: 'string' },
					supporterCount: { type: 'integer' }
				}
			},
			Usage: {
				type: 'object',
				properties: {
					verifiedActions: { type: 'integer' },
					maxVerifiedActions: { type: 'integer' },
					emailsSent: { type: 'integer' },
					maxEmails: { type: 'integer' }
				}
			},
			OrgResponse: {
				type: 'object',
				properties: {
					data: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							name: { type: 'string' },
							slug: { type: 'string' },
							description: { type: ['string', 'null'] },
							avatar: { type: ['string', 'null'] },
							createdAt: { type: 'string', format: 'date-time' },
							counts: {
								type: 'object',
								properties: {
									supporters: { type: 'integer' },
									campaigns: { type: 'integer' },
									templates: { type: 'integer' }
								}
							}
						}
					}
				}
			},
			CreateApiKeyInput: {
				type: 'object',
				required: ['orgSlug'],
				properties: {
					orgSlug: { type: 'string', description: 'Organization slug' },
					name: { type: 'string', default: 'Default', description: 'Display name for the key' },
					scopes: {
						type: 'array',
						items: { type: 'string', enum: ['read', 'write'] },
						default: ['read'],
						description: 'Permission scopes (write implies read)'
					}
				}
			},
			ApiKeyCreated: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					key: { type: 'string', description: 'Full API key — shown only once' },
					prefix: { type: 'string', description: 'Key prefix for identification (e.g. ck_live_abc...)' },
					name: { type: 'string' },
					scopes: { type: 'array', items: { type: 'string' } },
					createdAt: { type: 'string', format: 'date-time' }
				}
			},
			Event: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					title: { type: 'string' },
					description: { type: ['string', 'null'] },
					eventType: { type: 'string', enum: ['IN_PERSON', 'VIRTUAL', 'HYBRID'] },
					startAt: { type: 'string', format: 'date-time' },
					endAt: { type: ['string', 'null'], format: 'date-time' },
					timezone: { type: ['string', 'null'] },
					venue: { type: ['string', 'null'] },
					city: { type: ['string', 'null'] },
					state: { type: ['string', 'null'] },
					virtualUrl: { type: ['string', 'null'] },
					capacity: { type: ['integer', 'null'] },
					status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] },
					rsvpCount: { type: 'integer' },
					attendeeCount: { type: 'integer' },
					verifiedAttendees: { type: 'integer' },
					campaignId: { type: ['string', 'null'] },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' }
				}
			},
			EventDetail: {
				type: 'object',
				description: 'Full event detail including address and configuration fields',
				properties: {
					id: { type: 'string' },
					title: { type: 'string' },
					description: { type: ['string', 'null'] },
					eventType: { type: 'string', enum: ['IN_PERSON', 'VIRTUAL', 'HYBRID'] },
					startAt: { type: 'string', format: 'date-time' },
					endAt: { type: ['string', 'null'], format: 'date-time' },
					timezone: { type: ['string', 'null'] },
					venue: { type: ['string', 'null'] },
					address: { type: ['string', 'null'] },
					city: { type: ['string', 'null'] },
					state: { type: ['string', 'null'] },
					postalCode: { type: ['string', 'null'] },
					latitude: { type: ['number', 'null'] },
					longitude: { type: ['number', 'null'] },
					virtualUrl: { type: ['string', 'null'] },
					capacity: { type: ['integer', 'null'] },
					waitlistEnabled: { type: 'boolean' },
					requireVerification: { type: 'boolean' },
					status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] },
					rsvpCount: { type: 'integer' },
					attendeeCount: { type: 'integer' },
					verifiedAttendees: { type: 'integer' },
					campaignId: { type: ['string', 'null'] },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' }
				}
			},
			Donation: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					campaignId: { type: ['string', 'null'] },
					email: { type: 'string', format: 'email' },
					name: { type: ['string', 'null'] },
					amountCents: { type: 'integer' },
					currency: { type: 'string' },
					recurring: { type: 'boolean' },
					status: { type: 'string', enum: ['pending', 'completed', 'refunded'] },
					engagementTier: { type: 'integer' },
					completedAt: { type: ['string', 'null'], format: 'date-time' },
					createdAt: { type: 'string', format: 'date-time' }
				}
			},
			DonationDetail: {
				type: 'object',
				description: 'Full donation detail including Stripe and district fields',
				properties: {
					id: { type: 'string' },
					campaignId: { type: ['string', 'null'] },
					email: { type: 'string', format: 'email' },
					name: { type: ['string', 'null'] },
					amountCents: { type: 'integer' },
					currency: { type: 'string' },
					recurring: { type: 'boolean' },
					recurringInterval: { type: ['string', 'null'] },
					status: { type: 'string', enum: ['pending', 'completed', 'refunded'] },
					engagementTier: { type: 'integer' },
					districtHash: { type: ['string', 'null'] },
					stripeSessionId: { type: ['string', 'null'] },
					completedAt: { type: ['string', 'null'], format: 'date-time' },
					createdAt: { type: 'string', format: 'date-time' }
				}
			},
			Workflow: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					name: { type: 'string' },
					description: { type: ['string', 'null'] },
					trigger: { type: 'string' },
					stepCount: { type: 'integer' },
					enabled: { type: 'boolean' },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' }
				}
			},
			WorkflowDetail: {
				type: 'object',
				description: 'Full workflow detail including step definitions',
				properties: {
					id: { type: 'string' },
					name: { type: 'string' },
					description: { type: ['string', 'null'] },
					trigger: { type: 'string' },
					steps: { type: 'array', items: { type: 'object' }, description: 'Array of workflow step definitions' },
					stepCount: { type: 'integer' },
					enabled: { type: 'boolean' },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' }
				}
			},
			SmsBlast: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					body: { type: 'string' },
					fromNumber: { type: 'string' },
					status: { type: 'string', enum: ['draft', 'sending', 'sent', 'failed'] },
					totalRecipients: { type: 'integer' },
					sentCount: { type: 'integer' },
					failedCount: { type: 'integer' },
					campaignId: { type: ['string', 'null'] },
					sentAt: { type: ['string', 'null'], format: 'date-time' },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' }
				}
			},
			PatchThroughCall: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					callerPhone: { type: 'string' },
					targetPhone: { type: 'string' },
					targetName: { type: ['string', 'null'] },
					status: { type: 'string', enum: ['initiated', 'ringing', 'in-progress', 'completed', 'failed', 'no-answer', 'busy'] },
					duration: { type: ['integer', 'null'] },
					twilioCallSid: { type: ['string', 'null'] },
					campaignId: { type: ['string', 'null'] },
					districtHash: { type: ['string', 'null'] },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' }
				}
			},
			Representative: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					countryCode: { type: 'string' },
					constituencyId: { type: ['string', 'null'] },
					constituencyName: { type: ['string', 'null'] },
					name: { type: 'string' },
					party: { type: ['string', 'null'] },
					chamber: { type: ['string', 'null'] },
					office: { type: ['string', 'null'] },
					phone: { type: ['string', 'null'] },
					email: { type: ['string', 'null'] },
					websiteUrl: { type: ['string', 'null'] },
					photoUrl: { type: ['string', 'null'] },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' }
				}
			},
			Network: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					name: { type: 'string' },
					slug: { type: 'string' },
					description: { type: ['string', 'null'] },
					status: { type: 'string', enum: ['active', 'suspended'] },
					ownerOrgId: { type: 'string' },
					memberCount: { type: 'integer' },
					role: { type: 'string', enum: ['admin', 'member'] },
					joinedAt: { type: 'string', format: 'date-time' },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' }
				}
			},
			NetworkDetail: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					name: { type: 'string' },
					slug: { type: 'string' },
					description: { type: ['string', 'null'] },
					status: { type: 'string', enum: ['active', 'suspended'] },
					ownerOrgId: { type: 'string' },
					memberCount: { type: 'integer' },
					ownerOrg: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							name: { type: 'string' },
							slug: { type: 'string' }
						}
					},
					members: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								orgId: { type: 'string' },
								orgName: { type: 'string' },
								orgSlug: { type: 'string' },
								role: { type: 'string', enum: ['admin', 'member'] },
								joinedAt: { type: 'string', format: 'date-time' }
							}
						}
					},
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' }
				}
			},
			NetworkStats: {
				type: 'object',
				properties: {
					memberCount: { type: 'integer' },
					totalSupporters: { type: 'integer' },
					uniqueSupporters: { type: 'integer' },
					verifiedSupporters: { type: 'integer' },
					totalCampaignActions: { type: 'integer' },
					verifiedCampaignActions: { type: 'integer' },
					stateDistribution: {
						type: 'object',
						additionalProperties: { type: 'integer' },
						description: 'Geographic distribution by region code'
					}
				}
			},
			WebhookEvent: {
				type: 'string',
				enum: [
					'campaign_action.created',
					'campaign.updated',
					'supporter.created',
					'supporter.updated',
					'supporter.deleted',
					'donation.completed',
					'donation.refunded',
					'event.rsvp_created'
				],
				description:
					'Org-scoped event name. Payload schema is event-specific (JSON-encoded by sender).'
			},
			Webhook: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					url: { type: 'string', format: 'uri' },
					events: { type: 'array', items: { $ref: '#/components/schemas/WebhookEvent' } },
					enabled: { type: 'boolean' },
					description: { type: ['string', 'null'] },
					createdAt: { type: 'integer', description: 'Unix ms timestamp' },
					lastDeliveredAt: { type: ['integer', 'null'], description: 'Unix ms timestamp of last successful delivery' },
					failureCount: { type: 'integer', description: 'Consecutive delivery failures since last success. Auto-disable at 5 dead deliveries.' }
				}
			},
			WebhookCreated: {
				allOf: [
					{ $ref: '#/components/schemas/Webhook' },
					{
						type: 'object',
						required: ['signingSecret'],
						properties: {
							signingSecret: {
								type: 'string',
								description:
									'Signing secret used to verify deliveries via HMAC-SHA256(timestamp + "." + payload). Returned ONCE on creation — store it now. Cannot be retrieved later; rotate to generate a new one.'
							}
						}
					}
				]
			},
			WebhookSecretRotated: {
				type: 'object',
				required: ['id', 'signingSecret'],
				properties: {
					id: { type: 'string' },
					signingSecret: {
						type: 'string',
						description: 'New signing secret. The previous secret continues to verify within the rotation window.'
					}
				}
			},
			CreateWebhookInput: {
				type: 'object',
				required: ['url', 'events'],
				properties: {
					url: { type: 'string', format: 'uri', description: 'HTTPS endpoint to receive POST deliveries' },
					events: {
						type: 'array',
						minItems: 1,
						items: { $ref: '#/components/schemas/WebhookEvent' }
					},
					description: { type: 'string', maxLength: 500 }
				}
			},
			UpdateWebhookInput: {
				type: 'object',
				properties: {
					url: { type: 'string', format: 'uri' },
					events: { type: 'array', items: { $ref: '#/components/schemas/WebhookEvent' } },
					enabled: { type: 'boolean', description: 'Re-enabling resets failureCount to 0.' },
					description: { type: 'string', maxLength: 500 }
				}
			},
			ErrorEnvelope: {
				type: 'object',
				properties: {
					data: { type: 'null' },
					error: {
						type: 'object',
						properties: {
							code: { type: 'string' },
							message: { type: 'string' }
						},
						required: ['code', 'message']
					}
				}
			}
		},
		responses: {
			BadRequest: {
				description: 'Bad request — invalid input',
				content: {
					'application/json': {
						schema: { $ref: '#/components/schemas/ErrorEnvelope' },
						example: { data: null, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }
					}
				}
			},
			Unauthorized: {
				description: 'Authentication required or invalid API key',
				content: {
					'application/json': {
						schema: { $ref: '#/components/schemas/ErrorEnvelope' },
						example: { data: null, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header. Use: Bearer <api_key>' } }
					}
				}
			},
			Forbidden: {
				description: 'API key lacks required scope',
				content: {
					'application/json': {
						schema: { $ref: '#/components/schemas/ErrorEnvelope' },
						example: { data: null, error: { code: 'FORBIDDEN', message: "API key does not have the 'write' scope" } }
					}
				}
			},
			NotFound: {
				description: 'Resource not found',
				content: {
					'application/json': {
						schema: { $ref: '#/components/schemas/ErrorEnvelope' },
						example: { data: null, error: { code: 'NOT_FOUND', message: 'Resource not found' } }
					}
				}
			},
			Conflict: {
				description: 'Resource already exists',
				content: {
					'application/json': {
						schema: { $ref: '#/components/schemas/ErrorEnvelope' },
						example: { data: null, error: { code: 'CONFLICT', message: 'A resource with this identifier already exists' } }
					}
				}
			},
			InternalError: {
				description: 'Internal server error',
				content: {
					'application/json': {
						schema: { $ref: '#/components/schemas/ErrorEnvelope' },
						example: { data: null, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }
					}
				}
			}
		}
	}
} as const;
