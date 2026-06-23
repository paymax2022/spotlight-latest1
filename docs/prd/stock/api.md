# API Endpoints (Mobile, v1)

> All financial POSTs require idempotency keys + server-side pre-trade checks (see `compliance.md`). Base path `/api/v1`. Path params reconstructed (`:symbol`, `:id`, `:assetId`).

## Investment Profile
| Method | Path |
|---|---|
| GET | `/invest/profile` |
| POST | `/invest/start` |
| GET | `/invest/eligibility` |
| GET | `/invest/agreements` |
| POST | `/invest/agreements/accept` |

## Suitability
| GET | `/invest/suitability/questions` |
| POST | `/invest/suitability/submit` |
| GET | `/invest/suitability/result` |

## Stocks
| GET | `/stocks` |
| GET | `/stocks/search` |
| GET | `/stocks/:symbol` |
| GET | `/stocks/:symbol/chart` |
| GET | `/stocks/:symbol/news` |
| GET | `/stocks/:symbol/dividends` |
| GET | `/stocks/:symbol/corporate-actions` |

## Orders
| POST | `/stocks/orders/buy` |
| POST | `/stocks/orders/sell` |
| GET | `/stocks/orders` |
| GET | `/stocks/orders/:id` |
| POST | `/stocks/orders/:id/cancel` |

## Portfolio
| GET | `/invest/portfolio` |
| GET | `/invest/portfolio/positions` |
| GET | `/invest/portfolio/performance` |
| GET | `/invest/portfolio/statements` |
| POST | `/invest/portfolio/statements/export` |

## Wallet
| GET | `/invest/wallet` |
| POST | `/invest/wallet/deposit` |
| POST | `/invest/wallet/withdraw` |
| GET | `/invest/wallet/transactions` |

## Watchlists
| GET | `/invest/watchlists` |
| POST | `/invest/watchlists` |
| PATCH | `/invest/watchlists/:id` |
| DELETE | `/invest/watchlists/:id` |
| POST | `/invest/watchlists/:id/stocks` |
| DELETE | `/invest/watchlists/:id/stocks/:assetId` |

## Alerts
| GET | `/invest/alerts` |
| POST | `/invest/alerts` |
| PATCH | `/invest/alerts/:id` |
| DELETE | `/invest/alerts/:id` |

## Public Offers
| GET | `/invest/public-offers` |
| GET | `/invest/public-offers/:id` |
| POST | `/invest/public-offers/:id/apply` |
| GET | `/invest/public-offers/applications` |

## Rights Issues
| GET | `/invest/rights-issues` |
| GET | `/invest/rights-issues/:id` |
| POST | `/invest/rights-issues/:id/accept` |
| GET | `/invest/rights-issues/applications` |

## Learn
| GET | `/invest/learn/home` |
| GET | `/invest/learn/lessons` |
| GET | `/invest/learn/lessons/:id` |
| POST | `/invest/learn/quizzes/:id/submit` |

## AI Assistant (guardrailed — see `modules.md`)
| POST | `/invest/ai/chat` |
| POST | `/invest/ai/explain-stock` |
| POST | `/invest/ai/explain-order` |
| POST | `/invest/ai/explain-portfolio` |
