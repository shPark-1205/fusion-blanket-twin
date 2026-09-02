"""FastAPI adapter around the existing Fusion Blanket Twin services."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from fusion_blanket_twin.api.models import (
    DesignDomainResponse,
    DesignVariableDomain,
    HealthResponse,
    PredictionDesign,
    ScalarKpisResponse,
    ScalarPredictionMetadataResponse,
    ScalarPredictionRequest,
    ScalarPredictionResponse,
    GeometryDesignRequest,
    GeometryDesignResponse,
)
from fusion_blanket_twin.api.services import TwinServices, load_twin_services
from fusion_blanket_twin.surrogate.service import ScalarPredictionService


API_VERSION = "0.1.0"
LOCAL_FRONTEND_ORIGINS = (
    "http://127.0.0.1:3000",
    "http://localhost:3000",
)
LOGGER = logging.getLogger(__name__)
ServiceLoader = Callable[[], TwinServices]


def create_app(service_loader: ServiceLoader = load_twin_services) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.twin_services = service_loader()
        services: TwinServices = application.state.twin_services
        if services.error is not None:
            LOGGER.error("Scalar prediction service unavailable: %s", services.error)
        yield

    application = FastAPI(
        title="Fusion Blanket Twin API",
        version=API_VERSION,
        description=(
            "Thin HTTP adapter for scalar predictions and parametric component geometry. "
            "Design coordinates use MCNP centimetres; geometry responses use project millimetres."
        ),
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(LOCAL_FRONTEND_ORIGINS),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={
                "detail": "Request validation failed.",
                "errors": [
                    {
                        "location": list(error["loc"]),
                        "message": error["msg"],
                        "type": error["type"],
                    }
                    for error in exc.errors()
                ],
            },
        )

    @application.get("/api/health", response_model=HealthResponse)
    def health(request: Request) -> HealthResponse:
        services = _services(request)
        ready = services.scalar_prediction is not None
        return HealthResponse(
            status="ok" if ready else "degraded",
            api_version=API_VERSION,
            scalar_prediction="ready" if ready else "unavailable",
            case_count=services.case_count,
            startup_seconds=services.startup_seconds,
        )

    @application.get("/api/design-domain", response_model=DesignDomainResponse)
    def design_domain(request: Request) -> DesignDomainResponse:
        predictor = _predictor(request)
        pz_levels = sorted({record.primitive_csg.pz_206 for record in predictor.registry.records})
        cz_levels = sorted(
            {record.primitive_csg.cz_301_radius for record in predictor.registry.records}
        )
        return DesignDomainResponse(
            pz_206=DesignVariableDomain(
                minimum=float(predictor.domain_min[0]),
                maximum=float(predictor.domain_max[0]),
                levels=pz_levels,
            ),
            cz_301_radius=DesignVariableDomain(
                minimum=float(predictor.domain_min[1]),
                maximum=float(predictor.domain_max[1]),
                levels=cz_levels,
            ),
        )

    @application.post("/api/predict/scalars", response_model=ScalarPredictionResponse)
    def predict_scalars(
        payload: ScalarPredictionRequest,
        request: Request,
    ) -> ScalarPredictionResponse:
        predictor = _predictor(request)
        try:
            prediction = predictor.predict(payload.pz_206, payload.cz_301_radius)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Scientific prediction rejected the supplied design coordinates.",
            ) from exc
        except Exception as exc:
            LOGGER.exception("Unexpected scalar prediction failure")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Scalar prediction failed unexpectedly.",
            ) from exc

        return ScalarPredictionResponse(
            design=PredictionDesign(
                pz_206=prediction.pz_206,
                cz_301_radius=prediction.cz_301_radius,
                units=prediction.metadata.input_units,
            ),
            kpis=ScalarKpisResponse(**prediction.kpis.as_dict()),
            metadata=ScalarPredictionMetadataResponse(
                source=prediction.metadata.source,
                status=prediction.metadata.status,
                domain_status=prediction.metadata.domain_status,
                warning=prediction.metadata.warning,
                nearest_case=prediction.metadata.nearest_case_id,
                nearest_design=PredictionDesign(
                    pz_206=predictor.registry.by_case_id[prediction.metadata.nearest_case_id].primitive_csg.pz_206,
                    cz_301_radius=predictor.registry.by_case_id[prediction.metadata.nearest_case_id].primitive_csg.cz_301_radius,
                    units=prediction.metadata.input_units,
                ),
                nearest_distance=prediction.metadata.nearest_case_distance,
                model_name=prediction.metadata.model_name,
                model_metadata=prediction.metadata.model_metadata,
            ),
        )

    @application.post("/api/geometry/design", response_model=GeometryDesignResponse)
    def geometry_design(
        payload: GeometryDesignRequest,
        request: Request,
    ) -> GeometryDesignResponse:
        service = _geometry_service(request)
        try:
            result = service.generate(payload.pz_206, payload.cz_301_radius)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Parametric geometry rejected the supplied design coordinates.",
            ) from exc
        except Exception as exc:
            LOGGER.exception("Unexpected parametric geometry failure")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Parametric geometry generation failed unexpectedly.",
            ) from exc
        return GeometryDesignResponse(
            **result.payload,
            generation_ms=result.generation_ms,
            cache_hit=result.cache_hit,
        )

    return application


def _services(request: Request) -> TwinServices:
    return request.app.state.twin_services


def _predictor(request: Request) -> ScalarPredictionService:
    services = _services(request)
    if services.scalar_prediction is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Scalar prediction model is unavailable.",
        )
    return services.scalar_prediction


def _geometry_service(request: Request):
    service = _services(request).geometry
    if service is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Parametric geometry service is unavailable.",
        )
    return service


app = create_app()
