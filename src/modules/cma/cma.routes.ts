import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as c from "./cma.controller.js";

// /api/v1/cma (signed in)
export const cmaRoutes = Router();
cmaRoutes.use(requireAuth);
cmaRoutes.get("/me", c.me); //                          GET  /cma/me
cmaRoutes.get("/quota", c.quota); //                    GET  /cma/quota?agentName=
cmaRoutes.post("/uploads", c.upload); //                POST /cma/uploads  → { key, uploadUrl } (browser PUTs the file)
cmaRoutes.get("/", c.list); //                          GET  /cma
cmaRoutes.post("/", c.submit); //                       POST /cma
cmaRoutes.get("/:id", c.get); //                        GET  /cma/:id
cmaRoutes.put("/:id", c.update); //                     PUT  /cma/:id
cmaRoutes.post("/:id/list-price", c.setListPrice); //   POST /cma/:id/list-price
cmaRoutes.post("/:id/approval", c.approval); //         POST /cma/:id/approval (admins)

// /api/v1/cma-worker (the CMA builder; header x-worker-key)
export const cmaWorkerRoutes = Router();
cmaWorkerRoutes.use(c.requireWorkerKey);
cmaWorkerRoutes.get("/pending", c.workerPending); //          GET  /cma-worker/pending
cmaWorkerRoutes.get("/requests", c.workerList); //            GET  /cma-worker/requests?status=submitted
cmaWorkerRoutes.get("/requests/:id", c.workerGet); //         GET  /cma-worker/requests/:id (with file links)
cmaWorkerRoutes.post("/status", c.workerStatus); //           POST /cma-worker/status
cmaWorkerRoutes.post("/upload-url", c.workerUploadUrl); //    POST /cma-worker/upload-url { id, file: pdf|workbook }
cmaWorkerRoutes.post("/files", c.workerFiles); //             POST /cma-worker/files { id, pdfKey?, workbookKey? }
