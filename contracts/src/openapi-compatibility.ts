import type {
  AbsenceListResponse,
  AbsenceRequestDto,
  ChangeMonthClosureRequest,
  CreateAbsenceRequest,
  CreateEmployeeRequest,
  CreateWorkSessionRequest,
  DailyAttendanceOverview,
  EmployeeWorkRuleDto,
  EmployeeWorkRuleResponse,
  InviteEmployeeRequest,
  LocationDto,
  ManagerScopeDto,
  MonthlyAttendanceOverview,
  MonthlyAttendanceReport,
  MonthlyAttendanceReportRow,
  NamedStructureRequest,
  OrganisationStructureDto,
  ReviewAbsenceRequest,
  SetEmployeeWorkRuleRequest,
  SetManagerScopeRequest,
  SetTeamAssignmentRequest,
  TeamAssignmentDto,
  TeamDto,
  TodayAttendanceResponse,
  UpdateWorkSessionRequest,
  WorkBreakDto,
  WorkSessionDto,
} from "./index";
import type { components } from "./openapi.generated";

type Schemas = components["schemas"];
type Extends<Actual, Expected> = [Actual] extends [Expected] ? true : false;
type Assert<T extends true> = T;
type JsonShape<T> =
  T extends readonly (infer Item)[]
    ? JsonShape<Item>[]
    : T extends object
      ? { [Key in keyof T]: JsonShape<Exclude<T[Key], undefined>> }
      : T;
type Compatible<Dto, Schema> =
  Extends<JsonShape<Dto>, Schema> extends true
    ? Extends<Schema, JsonShape<Dto>>
    : false;

type ContractCompatibility = [
  Assert<Compatible<CreateAbsenceRequest, Schemas["CreateAbsence"]>>,
  Assert<Compatible<ReviewAbsenceRequest, Schemas["ReviewAbsence"]>>,
  Assert<Compatible<AbsenceRequestDto, Schemas["AbsenceRequest"]>>,
  Assert<Compatible<AbsenceListResponse, Schemas["AbsenceList"]>>,
  Assert<Compatible<NamedStructureRequest, Schemas["NamedStructure"]>>,
  Assert<Compatible<SetTeamAssignmentRequest, Schemas["TeamAssignment"]>>,
  Assert<Compatible<SetManagerScopeRequest, Schemas["ManagerScope"]>>,
  Assert<Compatible<LocationDto, Schemas["Location"]>>,
  Assert<Compatible<TeamDto, Schemas["Team"]>>,
  Assert<Compatible<TeamAssignmentDto, Schemas["TeamAssignmentDto"]>>,
  Assert<Compatible<ManagerScopeDto, Schemas["ManagerScopeDto"]>>,
  Assert<Compatible<OrganisationStructureDto, Schemas["OrganisationStructure"]>>,
  Assert<Compatible<ChangeMonthClosureRequest, Schemas["MonthClosureCommand"]>>,
  Assert<Compatible<InviteEmployeeRequest, Schemas["InviteEmployee"]>>,
  Assert<Compatible<CreateEmployeeRequest, Schemas["CreateEmployee"]>>,
  Assert<Compatible<WorkBreakDto, Schemas["WorkBreak"]>>,
  Assert<Compatible<WorkSessionDto, Schemas["WorkSession"]>>,
  Assert<Compatible<CreateWorkSessionRequest, Schemas["CreateInterval"]>>,
  Assert<Compatible<UpdateWorkSessionRequest, Schemas["UpdateInterval"]>>,
  Assert<Compatible<SetEmployeeWorkRuleRequest, Schemas["SetEmployeeWorkRule"]>>,
  Assert<Compatible<EmployeeWorkRuleDto, Schemas["EmployeeWorkRule"]>>,
  Assert<Compatible<EmployeeWorkRuleResponse, Schemas["EmployeeWorkRuleResponse"]>>,
  Assert<Compatible<DailyAttendanceOverview, Schemas["DailyAttendance"]>>,
  Assert<Compatible<TodayAttendanceResponse, Schemas["TodayAttendance"]>>,
  Assert<Compatible<MonthlyAttendanceOverview, Schemas["MonthlyAttendance"]>>,
  Assert<Compatible<MonthlyAttendanceReportRow, Schemas["MonthlyAttendanceReportRow"]>>,
  Assert<Compatible<MonthlyAttendanceReport, Schemas["MonthlyAttendanceReport"]>>,
];

export type OpenApiContractCompatibility = ContractCompatibility;
