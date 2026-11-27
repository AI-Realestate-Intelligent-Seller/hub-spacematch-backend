import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/auth.js";
import * as service from "./reel.service.js";

export const reelStudioRoutes = Router();
reelStudioRoutes.use(requireAuth);
const id = z.string().regex(/^[\w-]+$/).max(128);
reelStudioRoutes.get("/config", async (req, res) => { res.json(await service.configuration(req.user!)); });
reelStudioRoutes.get("/free", async (req, res) => { res.json(await service.freeInfo(req.user!, service.asQuery.parse(req.query).as)); });
reelStudioRoutes.get("/assets", async (req, res) => { res.json(await service.assetList(req.user!, service.asQuery.parse(req.query).as)); });
reelStudioRoutes.get("/drive", async (req, res) => { res.json(await service.driveList(req.user!, service.asQuery.parse(req.query).as)); });
reelStudioRoutes.post("/assets", async (req, res) => { res.status(201).json(await service.beginUpload(req.user!, service.uploadBody.parse(req.body))); });
reelStudioRoutes.post("/assets/:id/complete", async (req, res) => { res.json(await service.finishUpload(req.user!, id.parse(req.params.id), service.asQuery.parse(req.body).as)); });
reelStudioRoutes.get("/orders", async (req, res) => { res.json(await service.mine(req.user!, service.asQuery.parse(req.query).as)); });
reelStudioRoutes.get("/queue", async (req, res) => { res.json(await service.queue(req.user!)); });
reelStudioRoutes.post("/orders", async (req, res) => { res.status(201).json(await service.place(req.user!, service.placeBody.parse(req.body))); });
reelStudioRoutes.post("/orders/:id/actions", async (req, res) => { res.json(await service.transition(req.user!, id.parse(req.params.id), service.actionBody.parse(req.body))); });
