import { buildAnalytics, deleteAccountData, deleteActivity, listActivities, syncActivities } from "../services/activity.service.js";
import { syncActivitiesSchema } from "../utils/validators.js";

export async function sync(req, res, next) {
  try {
    const payload = syncActivitiesSchema.parse(req.body);
    const result = await syncActivities(req.user.sub, payload.activities);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function list(req, res, next) {
  try {
    const activities = await listActivities(req.user.sub);
    res.json({ activities });
  } catch (error) {
    next(error);
  }
}

export async function remove(req, res, next) {
  try {
    await deleteActivity(req.user.sub, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function deleteData(req, res, next) {
  try {
    await deleteAccountData(req.user.sub);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function analytics(req, res, next) {
  try {
    const data = await buildAnalytics(req.user.sub);
    res.json(data);
  } catch (error) {
    next(error);
  }
}
